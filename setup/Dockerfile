FROM node:20-alpine

RUN apk add --no-cache docker-cli docker-cli-compose bash iproute2

WORKDIR /app

COPY setup/package.json ./
RUN npm install --production

COPY setup/server.js ./
COPY setup/public ./public/
COPY templates /app/templates/

EXPOSE 3001

CMD ["node", "server.js"]
