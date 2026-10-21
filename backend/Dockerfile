FROM node:22-slim AS builder

WORKDIR /app

# Registry is overridable at build time for operators behind a mirror or proxy:
#   docker compose build --build-arg NPM_REGISTRY=https://registry.example.com
# The default is the public npm registry so that builds work for anyone, anywhere.
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
RUN npm config set fetch-retries 5
RUN npm config set fetch-retry-mintimeout 20000
RUN npm config set fetch-retry-maxtimeout 120000

# Prisma's query engine links against the system OpenSSL, and Prisma's platform
# detection reads the `openssl` binary to choose which engine to build. The
# node:*-slim base image ships neither, so `prisma generate` silently falls back to
# the OpenSSL 1.1.x engine and the service dies at runtime with
# "Prisma cannot find the required libssl system library". Installing it here keeps
# generation and runtime in agreement.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install deps
COPY package*.json ./
RUN npm ci --prefer-offline --no-audit --no-fund

# Copy prisma schema and generate client BEFORE building
COPY prisma ./prisma/
RUN npx prisma generate

# Copy source code and build
COPY . .
RUN npm run build

# Development target: keeps devDependencies (ts-node-dev, typescript) so that
# `docker compose up` can hot-reload without npx fetching a mismatched toolchain.
# Declared before `runner` so that `docker build .` with no --target still
# produces the production image.
FROM node:22-slim AS development

WORKDIR /app
ENV NODE_ENV=development

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}

COPY package*.json ./
RUN npm ci --prefer-offline --no-audit --no-fund

COPY prisma ./prisma/
RUN npx prisma generate

COPY . .

EXPOSE 3001

CMD ["npx", "ts-node-dev", "--respawn", "--transpile-only", "src/server.ts"]

# Production target (default).
FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

# Required at runtime, not just build time: the Prisma query engine dynamically links
# against the system OpenSSL, so the production image fails to start without it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}

COPY package*.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit --no-fund

# Copy built files and prisma client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3001

CMD ["node", "dist/server.js"]
