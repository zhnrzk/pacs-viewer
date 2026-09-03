#!/usr/bin/env bash
set -euo pipefail

COMPOSE_CMD=""
NETWORK_NAME="pacs"
SETUP_PORT=3001

echo ""
echo "========================================"
echo "  PACS viewer Setup Wizard"
echo "========================================"
echo ""

# --- Pre-flight checks ---

echo "[1/6] Checking Docker..."
if ! command -v docker &> /dev/null; then
  echo "  [FAIL] Docker is not installed"
  echo "  Fix: Install Docker from https://docs.docker.com/get-docker/"
  exit 1
fi
echo "  [PASS] Docker installed"

echo "[2/6] Checking Docker daemon..."
if ! docker info &> /dev/null 2>&1; then
  echo "  [FAIL] Docker daemon is not running"
  echo "  Fix: sudo systemctl start docker"
  exit 1
fi
echo "  [PASS] Docker daemon running"

echo "[3/6] Checking Docker Compose..."
if docker compose version &> /dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
  echo "  [PASS] Docker Compose (plugin) available"
elif command -v docker-compose &> /dev/null; then
  COMPOSE_CMD="docker-compose"
  echo "  [PASS] Docker Compose (standalone) available"
else
  echo "  [FAIL] Docker Compose not found"
  echo "  Fix: sudo apt install docker-compose-plugin (Debian/Ubuntu)"
  echo "       sudo dnf install docker-compose-plugin (Fedora)"
  exit 1
fi

echo "[4/6] Checking user permissions..."
if ! groups "$USER" 2>/dev/null | grep -q docker; then
  if ! id -nG "$USER" 2>/dev/null | grep -q docker; then
    echo "  [FAIL] User '$USER' is not in the docker group"
    echo "  Fix: sudo usermod -aG docker $USER"
    echo "       Then log out and back in, or run: newgrp docker"
    exit 1
  fi
fi
echo "  [PASS] User has docker permissions"

echo "[5/6] Checking Docker socket access..."
if ! docker ps &> /dev/null 2>&1; then
  echo "  [FAIL] Cannot access Docker socket"
  echo "  Fix: Ensure /var/run/docker.sock is accessible"
  exit 1
fi
echo "  [PASS] Docker socket accessible"

echo "[6/6] Checking default ports..."
PORT_CONFLICT=0
for port in 3000 8041 104; do
  if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
    echo "  [WARN] Port $port is in use (you can change it in the setup form)"
    PORT_CONFLICT=1
  fi
done
if [ "$PORT_CONFLICT" -eq 0 ]; then
  echo "  [PASS] Default ports available"
fi

echo ""
echo "All pre-flight checks passed."
echo ""

# --- Create Docker network ---

echo "Ensuring Docker network '${NETWORK_NAME}' exists..."
docker network create "${NETWORK_NAME}" 2>/dev/null || true
echo "  Network '${NETWORK_NAME}' ready."
echo ""

# --- Launch setup container ---

echo "Starting setup wizard on http://localhost:${SETUP_PORT}"
echo ""
echo "  1. Open http://localhost:${SETUP_PORT} in your browser"
echo "  2. Fill in the configuration form"
echo "  3. Click 'Deploy' to start all services"
echo ""

# Clean up any stale signal file
rm -f .deploy-ready

# Start setup container in background
${COMPOSE_CMD} -f docker-compose.setup.yml up --build &
SETUP_PID=$!

echo "Waiting for deployment..."
echo ""

# Poll for the deploy signal file
while [ ! -f .deploy-ready ]; do
  # Check if setup container is still running
  if ! kill -0 "$SETUP_PID" 2>/dev/null; then
    echo "Setup container exited unexpectedly."
    exit 1
  fi
  sleep 1
done

# Read the signal data
SIGNAL_DATA=$(cat .deploy-ready)
NETWORK_NAME=$(echo "$SIGNAL_DATA" | grep -o '"networkName":"[^"]*"' | cut -d'"' -f4)
VIEWER_PORT=$(echo "$SIGNAL_DATA" | grep -o '"viewerPort":"[^"]*"' | cut -d'"' -f4)

echo "Configs generated. Starting services on host..."
echo ""

# Run docker compose on the host (paths resolve correctly here)
${COMPOSE_CMD} up -d 2>&1

if [ $? -eq 0 ]; then
  echo ""
  echo "========================================"
  echo "  All services started successfully!"
  echo "  Viewer: http://localhost:${VIEWER_PORT:-3000}"
  echo "========================================"
else
  echo ""
  echo "[ERROR] Failed to start services"
fi

# Cleanup
rm -f .deploy-ready
${COMPOSE_CMD} -f docker-compose.setup.yml down 2>/dev/null || true
