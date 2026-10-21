# Development target: full dependency tree including the Next.js CLI, used by
# `docker compose up` for hot reload. Declared first so the default build below
# remains the production image.
FROM node:22-alpine AS development

WORKDIR /app
ENV NODE_ENV=development

# Registry is overridable at build time for operators behind a mirror or proxy.
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}

COPY package*.json ./
RUN npm ci --prefer-offline --no-audit --no-fund

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]

# Production target (default): standalone Next.js output, minimal runtime image.
FROM node:22-alpine AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}

COPY package*.json ./
RUN npm ci --prefer-offline --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
