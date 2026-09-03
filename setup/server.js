const express = require('express');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;
const PROJECT_ROOT = '/project';
const TEMPLATES_DIR = '/app/templates';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function runPreflightChecks() {
  const checks = [];

  // Docker socket
  try {
    execSync('docker info', { timeout: 5000, stdio: 'pipe' });
    checks.push({ name: 'Docker daemon reachable', status: 'pass' });
  } catch {
    checks.push({ name: 'Docker daemon reachable', status: 'fail', fix: 'Ensure Docker is installed and the daemon is running. On Linux: sudo systemctl start docker' });
  }

  // Docker Compose
  let composeCmd = null;
  try {
    execSync('docker compose version', { timeout: 5000, stdio: 'pipe' });
    composeCmd = 'docker compose';
    checks.push({ name: 'Docker Compose available', status: 'pass' });
  } catch {
    try {
      execSync('docker-compose version', { timeout: 5000, stdio: 'pipe' });
      composeCmd = 'docker-compose';
      checks.push({ name: 'Docker Compose available', status: 'pass' });
    } catch {
      checks.push({ name: 'Docker Compose available', status: 'fail', fix: 'Install docker-compose-plugin: sudo apt install docker-compose-plugin (Debian/Ubuntu) or sudo dnf install docker-compose-plugin (Fedora)' });
    }
  }

  // Docker socket mounted (check if we can list containers)
  try {
    execSync('docker ps', { timeout: 5000, stdio: 'pipe' });
    checks.push({ name: 'Docker socket accessible', status: 'pass' });
  } catch {
    checks.push({ name: 'Docker socket accessible', status: 'fail', fix: 'The Docker socket is not mounted. Re-run with: -v /var/run/docker.sock:/var/run/docker.sock' });
  }

  // Check if docker network exists
  const networkName = 'pacs';
  try {
    execSync(`docker network inspect ${networkName}`, { timeout: 5000, stdio: 'pipe' });
    checks.push({ name: `Network "${networkName}" exists`, status: 'pass' });
  } catch {
    checks.push({ name: `Network "${networkName}" exists`, status: 'warn', fix: `Network "${networkName}" will be created automatically when services start.` });
  }

  // Port checks
  const ports = [
    { port: 3000, label: 'Viewer port (3000)' },
    { port: 8041, label: 'DICOM server HTTP port (8041)' },
    { port: 104, label: 'DICOM port (104)' },
  ];
  for (const { port, label } of ports) {
    try {
      const result = execSync(`ss -tlnp sport = :${port}`, { timeout: 5000, stdio: 'pipe' }).toString();
      if (result.includes(`:${port}`)) {
        checks.push({ name: label, status: 'fail', fix: `Port ${port} is in use. Stop the conflicting process or change this port in the setup form.` });
      } else {
        checks.push({ name: label, status: 'pass' });
      }
    } catch {
      checks.push({ name: label, status: 'pass' });
    }
  }

  return { checks, composeCmd };
}

app.get('/api/preflight', (req, res) => {
  const result = runPreflightChecks();
  res.json(result);
});

function renderTemplate(templatePath, variables) {
  let content = fs.readFileSync(templatePath, 'utf8');
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    content = content.replace(regex, value);
  }
  return content;
}

app.post('/api/deploy', (req, res) => {
  const config = req.body;

  // Generate base64 auth token
  const credentials = `${config.username}:${config.password}`;
  const authBase64 = Buffer.from(credentials).toString('base64');

  const variables = {
    APP_NAME: config.appName || 'PACS Viewer',
    FOOTER_TEXT: config.footerText || 'Radiology Department',
    VIEWER_PORT: String(config.viewerPort || 3000),
    DICOM_PORT: String(config.dicomPort || 104),
    HTTP_PORT: String(config.httpPort || 8041),
    AET: config.aet || 'PACS',
    USERNAME: config.username || 'admin',
    PASSWORD: config.password || 'admin.1234',
    NETWORK_NAME: config.networkName || 'pacs',
    DICOM_SERVER_NAME: config.dicomServerName || 'DICOM server',
    AUTH_BASE64: authBase64,
    SHOW_LOGO: /^[Yy]/.test(config.showLogo) ? 'true' : 'false',
  };

  const templateFiles = [
    { template: 'pacs-server.json', output: 'pacs-server.json' },
    { template: 'nginx_viewer.conf', output: 'nginx_viewer.conf' },
    { template: 'viewer.js', output: 'viewer.js' },
    { template: 'index.html', output: 'index.html' },
    { template: 'manifest.json', output: 'manifest.json' },
    { template: 'docker-compose.yml', output: 'docker-compose.yml' },
  ];

  try {
    for (const { template, output } of templateFiles) {
      const templatePath = path.join(TEMPLATES_DIR, template);
      const outputPath = path.join(PROJECT_ROOT, output);
      const rendered = renderTemplate(templatePath, variables);
      fs.writeFileSync(outputPath, rendered, 'utf8');
      console.log(`Generated: ${output}`);
    }
  } catch (err) {
    console.error('Config generation failed:', err.message);
    return res.status(500).json({ success: false, error: `Failed to generate configs: ${err.message}` });
  }

  // Create docker network if it doesn't exist
  try {
    execSync(`docker network create ${variables.NETWORK_NAME} 2>/dev/null || true`, { timeout: 10000 });
    console.log(`Docker network "${variables.NETWORK_NAME}" ready`);
  } catch (err) {
    console.error('Network creation failed:', err.message);
  }

  // Signal the host to run docker compose up -d
  // The host script (start.sh) watches for this file and runs compose there,
  // avoiding bind-mount path resolution issues when compose runs inside the container.
  try {
    const signalData = JSON.stringify({
      networkName: variables.NETWORK_NAME,
      viewerPort: variables.VIEWER_PORT,
      timestamp: Date.now(),
    });
    fs.writeFileSync(path.join(PROJECT_ROOT, '.deploy-ready'), signalData, 'utf8');
    console.log('Deploy signal written. Host will start services...');
  } catch (err) {
    console.error('Failed to write deploy signal:', err.message);
    return res.status(500).json({ success: false, error: `Failed to signal deployment: ${err.message}` });
  }

  res.json({
    success: true,
    message: 'Configuration generated. Services are starting...',
    viewerUrl: `http://localhost:${variables.VIEWER_PORT}`,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n========================================`);
  console.log(`  PACS viewer Setup Wizard`);
  console.log(`  Open http://localhost:${PORT} to configure`);
  console.log(`========================================\n`);
});
