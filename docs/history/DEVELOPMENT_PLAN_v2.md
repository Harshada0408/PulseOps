# API Monitor SaaS v2.0 — Complete Ubuntu 24.04 Development Plan
## From Zero to a Deployable MVP

---

## PHASE 0: UBUNTU 24.04 ENVIRONMENT SETUP (Day 1)

### 0.1 System Preparation
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install essential packages
sudo apt install -y curl wget git build-essential software-properties-common     apt-transport-https ca-certificates gnupg lsb-release

# Install Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node -v  # Should show v22.x.x
npm -v   # Should show 10.x.x

# Install PM2 globally
sudo npm install -g pm2

# Install Docker
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" |     sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Verify Docker
docker --version
docker compose version

# Install PostgreSQL client (for local dev)
sudo apt install -y postgresql-client

# Install Ngrok (for webhook testing)
curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update && sudo apt install ngrok
```

### 0.2 Git Configuration
```bash
# Configure Git
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
git config --global init.defaultBranch main
git config --global core.editor "nano"

# Install GitHub CLI
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" |     sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update && sudo apt install gh

# Authenticate with GitHub
gh auth login
```

### 0.3 Project Directory Structure
```bash
# Create project directory
mkdir -p ~/projects/api-monitor-saas
cd ~/projects/api-monitor-saas

# Initialize Git repository
git init

# Create initial structure
mkdir -p {backend,frontend,worker,shared,docs,scripts,.github/workflows}
touch README.md .gitignore

# Initial commit
git add .
git commit -m "chore: initial project structure"
```

---

## PHASE 1: BACKEND FOUNDATION (Days 2-5)
### Branch: `feature/backend-core`

### 1.1 Create Branch & Setup
```bash
git checkout -b feature/backend-core

cd backend
npm init -y
npm install express cors helmet morgan dotenv bcryptjs jsonwebtoken zod
npm install -D typescript @types/node @types/express @types/cors @types/bcryptjs @types/jsonwebtoken ts-node-dev prisma @prisma/client
npx tsc --init
```

### 1.2 Database Setup with Prisma
```bash
npx prisma init
# Edit .env with DATABASE_URL
npx prisma db push
npx prisma generate
```

### 1.3 Core Files to Create
```
backend/
├── src/
│   ├── server.ts           # Entry point
│   ├── config/
│   │   ├── database.ts     # Prisma client
│   │   └── env.ts          # Environment validation
│   ├── middleware/
│   │   ├── auth.ts         # JWT verification
│   │   ├── error.ts        # Error handling
│   │   ├── rateLimit.ts    # Rate limiting
│   │   └── validate.ts     # Request validation
│   ├── routes/
│   │   ├── auth.ts         # Authentication
│   │   ├── monitors.ts     # Monitor CRUD
│   │   ├── checks.ts       # Check history
│   │   ├── billing.ts      # Stripe integration
│   │   └── analytics.ts    # Dashboard data
│   ├── services/
│   │   ├── monitor.ts      # Monitor logic
│   │   ├── check.ts        # Health check execution
│   │   ├── alert.ts        # Alert dispatch
│   │   └── stripe.ts       # Payment processing
│   ├── utils/
│   │   ├── logger.ts       # Winston logger
│   │   ├── email.ts        # Resend integration
│   │   └── helpers.ts      # Common utilities
│   └── types/
│       └── index.ts        # TypeScript types
├── prisma/
│   └── schema.prisma       # Database schema
├── tests/
│   └── *.test.ts           # Unit tests
├── .env.example
├── .env
├── package.json
├── tsconfig.json
└── Dockerfile
```

### 1.4 Implementation Checklist
- [ ] Express server with middleware (helmet, cors, morgan, rate-limit)
- [ ] Environment validation with Zod
- [ ] Prisma schema with all entities
- [ ] Database connection and client
- [ ] JWT authentication middleware
- [ ] Auth routes (signup, signin, signout, me, reset-password)
- [ ] Monitor CRUD routes with validation
- [ ] Check history routes
- [ ] Basic analytics (uptime %, avg response time)
- [ ] Error handling middleware
- [ ] Winston logger setup
- [ ] Input validation middleware
- [ ] Health check endpoint (/health)
- [ ] Docker configuration
- [ ] Unit tests for services

### 1.5 Commit & PR
```bash
# Stage all changes
git add backend/
git commit -m "feat: implement backend core with auth, monitors, and analytics

- Express server with security middleware
- Prisma ORM with PostgreSQL
- JWT authentication via Supabase
- Monitor CRUD with validation
- Check history and analytics
- Winston logging
- Docker support
- Unit tests"

# Push to remote
git push origin feature/backend-core

# Create PR via GitHub CLI
gh pr create --title "feat: Backend Core Implementation"     --body "## Changes
- Express API server
- Authentication system
- Monitor management
- Analytics endpoints
- Docker support

## Testing
- [ ] Run npm test
- [ ] Verify database migrations
- [ ] Test auth endpoints
- [ ] Test monitor CRUD

## Checklist
- [ ] Code follows style guide
- [ ] Tests pass
- [ ] Documentation updated"     --base develop
```

---

## PHASE 2: MONITORING WORKER (Days 6-8)
### Branch: `feature/worker-service`

### 2.1 Create Branch
```bash
git checkout develop
git pull origin develop
git checkout -b feature/worker-service
```

### 2.2 Worker Implementation
```bash
cd worker
npm init -y
npm install axios node-cron bullmq ioredis dotenv
npm install -D typescript @types/node @types/node-cron ts-node-dev
```

### 2.3 Core Worker Files
```
worker/
├── src/
│   ├── index.ts            # Entry point
│   ├── scheduler.ts        # Cron job scheduler
│   ├── executor.ts         # HTTP check executor
│   ├── queue.ts            # BullMQ queue setup
│   ├── processor.ts        # Job processor
│   ├── alert-dispatch.ts   # Alert sender
│   ├── services/
│   │   ├── monitor-fetch.ts
│   │   ├── check-store.ts
│   │   └── alert-service.ts
│   └── utils/
│       ├── logger.ts
│       └── helpers.ts
├── .env.example
├── package.json
├── tsconfig.json
└── Dockerfile
```

### 2.4 Worker Logic
```typescript
// scheduler.ts - Runs every 30 seconds
// 1. Fetch all active monitors from DB
// 2. Group by interval
// 3. Add jobs to BullMQ queue

// executor.ts - Job processor
// 1. Receive monitor config from queue
// 2. Execute HTTP request with timeout
// 3. Measure response time
// 4. Validate status code & keyword
// 5. Store result in DB
// 6. If status changed, trigger alert

// alert-dispatch.ts
// 1. Check alert rules
// 2. Send email via Resend
// 3. Send Slack webhook (if configured)
// 4. Update alert status
```

### 2.5 Commit & PR
```bash
git add worker/
git commit -m "feat: implement monitoring worker service

- Cron-based scheduler (30s intervals)
- BullMQ job queue with Redis
- HTTP check executor with timeout
- Response time measurement
- Status change detection
- Email alerts via Resend
- Slack webhook support
- Docker support"

git push origin feature/worker-service
gh pr create --title "feat: Monitoring Worker Service" --base develop
```

---

## PHASE 3: FRONTEND DASHBOARD (Days 9-14)
### Branch: `feature/frontend-dashboard`

### 3.1 Create Branch
```bash
git checkout develop
git pull origin develop
git checkout -b feature/frontend-dashboard
```

### 3.2 Next.js Setup
```bash
cd frontend
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
# Select: Yes to Tailwind, Yes to ESLint, Yes to App Router, Yes to src dir

# Install dependencies
npm install @supabase/supabase-js @supabase/auth-helpers-nextjs
npm install zustand axios recharts lucide-react clsx tailwind-merge
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-tabs
npm install @radix-ui/react-toast @radix-ui/react-tooltip @radix-ui/react-select
npm install class-variance-authority
npm install -D @types/node
```

### 3.3 Frontend Structure
```
frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout with providers
│   │   ├── page.tsx            # Landing page
│   │   ├── globals.css         # Global styles
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   ├── signup/page.tsx
│   │   │   └── reset-password/page.tsx
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx      # Dashboard shell
│   │   │   ├── page.tsx        # Overview
│   │   │   ├── monitors/
│   │   │   │   ├── page.tsx    # Monitor list
│   │   │   │   ├── [id]/page.tsx # Monitor detail
│   │   │   │   └── new/page.tsx # Create monitor
│   │   │   ├── analytics/
│   │   │   │   └── page.tsx    # Analytics charts
│   │   │   ├── alerts/
│   │   │   │   └── page.tsx    # Alert history
│   │   │   ├── billing/
│   │   │   │   └── page.tsx    # Subscription management
│   │   │   └── settings/
│   │   │       └── page.tsx    # User settings
│   │   └── status/
│   │       └── [slug]/page.tsx  # Public status page
│   ├── components/
│   │   ├── ui/                 # shadcn/ui components
│   │   ├── layout/
│   │   │   ├── sidebar.tsx
│   │   │   ├── header.tsx
│   │   │   └── shell.tsx
│   │   ├── monitors/
│   │   │   ├── monitor-card.tsx
│   │   │   ├── monitor-form.tsx
│   │   │   ├── monitor-stats.tsx
│   │   │   └── status-badge.tsx
│   │   ├── charts/
│   │   │   ├── uptime-chart.tsx
│   │   │   ├── response-time-chart.tsx
│   │   │   └── status-timeline.tsx
│   │   └── shared/
│   │       ├── loading.tsx
│   │       ├── error.tsx
│   │       └── empty-state.tsx
│   ├── hooks/
│   │   ├── use-auth.ts
│   │   ├── use-monitors.ts
│   │   ├── use-monitor.ts
│   │   ├── use-analytics.ts
│   │   └── use-subscription.ts
│   ├── lib/
│   │   ├── supabase-client.ts
│   │   ├── api-client.ts
│   │   └── utils.ts
│   ├── stores/
│   │   └── auth-store.ts
│   └── types/
│       └── index.ts
├── public/
│   └── assets/
├── components.json
├── tailwind.config.ts
├── next.config.js
└── package.json
```

### 3.4 Key Features to Implement
- [ ] Supabase auth integration (login/signup/logout)
- [ ] Protected routes middleware
- [ ] Dashboard layout with sidebar navigation
- [ ] Monitor list with real-time status
- [ ] Create monitor form with validation
- [ ] Monitor detail page with charts
- [ ] Uptime percentage calculation
- [ ] Response time line chart (Recharts)
- [ ] Status timeline visualization
- [ ] Alert history table
- [ ] Billing page with Stripe Checkout
- [ ] Settings page
- [ ] Public status page (unauthenticated)
- [ ] Responsive design (mobile-friendly)
- [ ] Dark mode support
- [ ] Loading states & error boundaries
- [ ] Toast notifications
- [ ] Real-time updates (polling/SSE)

### 3.5 Commit & PR
```bash
git add frontend/
git commit -m "feat: implement Next.js frontend dashboard

- Next.js 14 App Router with TypeScript
- Tailwind CSS + shadcn/ui components
- Supabase authentication
- Dashboard with sidebar layout
- Monitor CRUD interface
- Real-time status cards
- Recharts analytics visualizations
- Stripe billing integration
- Public status pages
- Responsive design
- Dark mode support"

git push origin feature/frontend-dashboard
gh pr create --title "feat: Frontend Dashboard" --base develop
```

---

## PHASE 4: INTEGRATION & TESTING (Days 15-17)
### Branch: `feature/integration-testing`

### 4.1 Docker Compose Setup
```bash
git checkout develop
git pull origin develop
git checkout -b feature/integration-testing
```

### 4.2 Docker Compose Configuration
```yaml
# docker-compose.yml
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: api_monitor
      POSTGRES_PASSWORD: dev_password
      POSTGRES_DB: api_monitor
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  backend:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=postgresql://api_monitor:dev_password@postgres:5432/api_monitor
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - redis

  worker:
    build: ./worker
    environment:
      - DATABASE_URL=postgresql://api_monitor:dev_password@postgres:5432/api_monitor
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - redis

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:3001
```

### 4.3 Integration Testing
```bash
# Create test suite
cd backend
npm install -D jest supertest @types/jest @types/supertest
npx jest --init

# Test files to create:
# - tests/auth.test.ts
# - tests/monitors.test.ts
# - tests/checks.test.ts
# - tests/billing.test.ts
# - tests/integration.test.ts
```

### 4.4 E2E Testing (Playwright)
```bash
cd frontend
npm install -D @playwright/test
npx playwright install

# Test files:
# - e2e/auth.spec.ts
# - e2e/monitors.spec.ts
# - e2e/dashboard.spec.ts
```

### 4.5 GitHub Actions CI
```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  backend:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: cd backend && npm ci
      - run: cd backend && npx prisma migrate deploy
      - run: cd backend && npm test

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: cd frontend && npm ci
      - run: cd frontend && npm run build
```

### 4.6 Commit & PR
```bash
git add docker-compose.yml .github/ backend/tests/ frontend/e2e/
git commit -m "feat: add integration testing and CI/CD

- Docker Compose development environment
- Jest unit tests for backend
- Playwright E2E tests for frontend
- GitHub Actions CI pipeline
- Integration test suite
- Test database setup"

git push origin feature/integration-testing
gh pr create --title "feat: Integration Testing & CI/CD" --base develop
```

---

## PHASE 5: STRIPE BILLING & PAYMENTS (Days 18-20)
### Branch: `feature/stripe-billing`

### 5.1 Stripe Setup
```bash
git checkout develop
git pull origin develop
git checkout -b feature/stripe-billing
```

### 5.2 Implementation
- [ ] Stripe account setup
- [ ] Product/Price creation (Free, Basic $9/mo, Pro $29/mo)
- [ ] Checkout session creation
- [ ] Billing portal integration
- [ ] Webhook handling (checkout.completed, invoice.paid, subscription.deleted)
- [ ] Plan limits enforcement
- [ ] Subscription status in UI
- [ ] Upgrade/downgrade flow

### 5.3 Commit & PR
```bash
git commit -m "feat: implement Stripe billing and subscriptions

- Stripe Checkout integration
- Billing portal access
- Webhook handlers for subscription events
- Plan limit enforcement
- Subscription management UI
- Upgrade/downgrade flows"

git push origin feature/stripe-billing
gh pr create --title "feat: Stripe Billing Integration" --base develop
```

---

## PHASE 6: PRODUCTION DEPLOYMENT (Days 21-23)
### Branch: `release/v1.0.0`

### 6.1 Create Release Branch
```bash
git checkout develop
git pull origin develop
git checkout -b release/v1.0.0
```

### 6.2 Production Configuration
```bash
# Update version numbers
# Final testing
# Update documentation
# Create CHANGELOG.md
```

### 6.3 Server Deployment Script
```bash
#!/bin/bash
# scripts/deploy.sh

set -e

VERSION=$1
SERVER_USER="deploy"
SERVER_HOST="your-server.com"
APP_DIR="/opt/api-monitor"

echo "Deploying version $VERSION..."

# Build Docker images
docker build -t api-monitor-api:$VERSION ./backend
docker build -t api-monitor-worker:$VERSION ./worker
docker build -t api-monitor-web:$VERSION ./frontend

# Save and transfer images
docker save api-monitor-api:$VERSION | ssh $SERVER_USER@$SERVER_HOST "docker load"
docker save api-monitor-worker:$VERSION | ssh $SERVER_USER@$SERVER_HOST "docker load"
docker save api-monitor-web:$VERSION | ssh $SERVER_USER@$SERVER_HOST "docker load"

# Update docker-compose on server
ssh $SERVER_USER@$SERVER_HOST "
  cd $APP_DIR
  export VERSION=$VERSION
  docker compose -f docker-compose.prod.yml down
  docker compose -f docker-compose.prod.yml up -d
"

echo "Deployment complete!"
```

### 6.4 Merge to Main
```bash
# After testing release branch
git checkout main
git merge release/v1.0.0
git tag -a v1.0.0 -m "Release v1.0.0 - MVP"
git push origin main --tags

# Merge back to develop
git checkout develop
git merge release/v1.0.0
git push origin develop
```

---

## COMPLETE GIT WORKFLOW SUMMARY

```bash
# 1. Start new feature
git checkout develop
git pull origin develop
git checkout -b feature/your-feature

# 2. Work on feature (multiple commits)
git add .
git commit -m "feat: your feature description"

# 3. Push and create PR
git push origin feature/your-feature
gh pr create --title "feat: Your Feature" --body "Description" --base develop

# 4. Code review & merge (via GitHub UI or CLI)
gh pr merge --squash

# 5. Update local develop
git checkout develop
git pull origin develop

# 6. For releases
git checkout -b release/v1.0.0
git checkout main
git merge release/v1.0.0
git tag v1.0.0
git push origin main --tags
```

---

## UBUNTU SERVICE SETUP (Production)

### Systemd Service for API
```ini
# /etc/systemd/system/api-monitor-api.service
[Unit]
Description=API Monitor API Server
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/api-monitor/current/backend
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/opt/api-monitor/.env

[Install]
WantedBy=multi-user.target
```

### Systemd Service for Worker
```ini
# /etc/systemd/system/api-monitor-worker.service
[Unit]
Description=API Monitor Worker
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/api-monitor/current/worker
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/opt/api-monitor/.env

[Install]
WantedBy=multi-user.target
```

### Enable Services
```bash
sudo systemctl daemon-reload
sudo systemctl enable api-monitor-api
sudo systemctl enable api-monitor-worker
sudo systemctl start api-monitor-api
sudo systemctl start api-monitor-worker

# Check status
sudo systemctl status api-monitor-api
sudo journalctl -u api-monitor-api -f
```

---

## NGINX CONFIGURATION (Production)

```nginx
# /etc/nginx/sites-available/api-monitor
upstream api_backend {
    server 127.0.0.1:3001;
    keepalive 32;
}

upstream frontend {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Frontend
    location / {
        proxy_pass http://frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # API
    location /api/ {
        proxy_pass http://api_backend/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Rate limiting
        limit_req zone=api_limit burst=20 nodelay;
    }

    # Static assets
    location /_next/static/ {
        proxy_pass http://frontend;
        proxy_cache_valid 200 365d;
        add_header Cache-Control "public, immutable";
    }

    # Webhook (no rate limit)
    location /api/v1/billing/webhook {
        proxy_pass http://api_backend/api/v1/billing/webhook;
        proxy_http_version 1.1;
    }
}
```

---

## SSL CERTIFICATE (Let's Encrypt)
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
sudo certbot renew --dry-run
```

---

## COMPLETE PROJECT TIMELINE

| Phase | Days | Branch | Deliverable |
|-------|------|--------|-------------|
| Environment Setup | 1 | main | Ubuntu configured, Git ready |
| Backend Core | 2-5 | feature/backend-core | Working API with auth & monitors |
| Worker Service | 6-8 | feature/worker-service | Monitoring & alerting |
| Frontend Dashboard | 9-14 | feature/frontend-dashboard | Complete UI |
| Integration & Testing | 15-17 | feature/integration-testing | Docker, tests, CI |
| Stripe Billing | 18-20 | feature/stripe-billing | Payments & subscriptions |
| Production Deploy | 21-23 | release/v1.0.0 | Live MVP |

**Total: 23 days to production MVP**

---

## EMERGENCY PROCEDURES

### Rollback Deployment
```bash
# Quick rollback to previous version
ssh deploy@server "cd /opt/api-monitor && docker compose down && ln -sf releases/v0.9.9 current && docker compose up -d"
```

### Database Backup
```bash
# Automated daily backup
0 2 * * * pg_dump $DATABASE_URL | gzip > /opt/api-monitor/backups/daily/api-monitor-$(date +%Y%m%d).sql.gz

# Restore
gunzip < backup.sql.gz | psql $DATABASE_URL
```

### Log Analysis
```bash
# View real-time logs
sudo journalctl -u api-monitor-api -f

# Search errors
grep "ERROR" /var/log/api-monitor/app.log | tail -100
```
