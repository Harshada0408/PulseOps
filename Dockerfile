# Combined API + Worker image for free-tier single-service hosting (Render).
#
# Runs the Express API (port 3001) and the monitoring worker in one container
# so a single free web service can serve both. A scheduled cron pings /health
# to keep the free instance awake on platforms that sleep on idle (e.g. Render).
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Registry is overridable at build time for operators behind a mirror or proxy:
#   docker build --build-arg NPM_REGISTRY=https://registry.example.com .
# The default is the public npm registry so that builds work for anyone, anywhere.
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
RUN npm config set fetch-retries 5
RUN npm config set fetch-retry-mintimeout 20000
RUN npm config set fetch-retry-maxtimeout 120000

# Copy workspace manifests + lockfile, install once at the root
COPY package*.json ./
COPY core/package*.json ./core/
COPY backend/package*.json ./backend/
COPY worker/package*.json ./worker/
COPY frontend/package*.json ./frontend/
RUN npm ci --prefer-offline --no-audit --no-fund --workspaces=false && npm ci --prefer-offline --no-audit --no-fund

# Prisma schema + generation (worker reuses the backend schema)
COPY backend/prisma ./backend/prisma
RUN npm run db:generate -w backend && npm run db:generate -w worker

# Source + builds
COPY . .
RUN npm run build -w core && npm run build -w backend && npm run build -w worker

ENV NODE_ENV=production
EXPOSE 3001

COPY docker/start-combined.sh /usr/local/bin/start-combined.sh
RUN chmod +x /usr/local/bin/start-combined.sh

CMD ["/usr/local/bin/start-combined.sh"]