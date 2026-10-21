# Worker image. Built from the repo root (not ./worker) so it can generate the
# Prisma client from the single shared schema at backend/prisma.
FROM node:22-slim AS development

WORKDIR /app
ENV NODE_ENV=development

# Prisma's query engine links against the system OpenSSL, and Prisma's platform
# detection reads the `openssl` binary to choose which engine to build. The
# node:*-slim base image ships neither, so `prisma generate` silently falls back to
# the OpenSSL 1.1.x engine and the worker dies at runtime with
# "Prisma cannot find the required libssl system library".
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Registry is overridable at build time for operators behind a mirror or proxy.
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}

# Workspace manifests + lockfile, install once at the root
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
COPY worker/package*.json ./worker/

RUN npm ci --prefer-offline --no-audit --no-fund

# Prisma schema + client generation (worker shares the backend schema)
COPY backend/prisma ./backend/prisma
RUN npm run db:generate -w worker

COPY worker/src ./worker/src
COPY worker/tsconfig.json ./worker/

EXPOSE 3002

CMD ["npx", "ts-node-dev", "--respawn", "--transpile-only", "src/index.ts"]

# Production target (default).
FROM node:22-slim AS production

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}

COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
COPY worker/package*.json ./worker/

RUN npm ci --prefer-offline --no-audit --no-fund

COPY backend/prisma ./backend/prisma
RUN npm run db:generate -w worker

COPY worker/src ./worker/src
COPY worker/tsconfig.json ./worker/

RUN npm run build -w worker

ENV NODE_ENV=production
EXPOSE 3002

CMD ["node", "worker/dist/index.js"]