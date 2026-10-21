# API Monitor SaaS v2.0 — Complete Ubuntu 24.04 Setup Guide

## Prerequisites
- Ubuntu Server 24.04 LTS (fresh install recommended)
- Root or sudo access
- Domain name (for production SSL)
- Supabase account (for auth & database)
- Stripe account (for billing)
- Resend account (for email alerts)

---

## Step 1: System Setup (Run on Ubuntu Server)

```bash
# SSH into your Ubuntu server
ssh user@your-server-ip

# Run the automated setup script
curl -fsSL https://raw.githubusercontent.com/your-org/api-monitor-saas/main/scripts/setup-ubuntu.sh | bash

# Or manually:

# 1. Update system
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Install Docker
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" |     sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker

# 4. Install PM2
sudo npm install -g pm2

# 5. Install Nginx & Certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# 6. Configure Firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

---

## Step 2: Git Repository Setup

```bash
# Create project directory
sudo mkdir -p /opt/api-monitor
sudo chown $USER:$USER /opt/api-monitor
cd /opt/api-monitor

# Initialize Git repo
git init

# Set up GitFlow branching
git checkout -b main
git checkout -b develop

# Create initial commit with project structure
git add .
git commit -m "chore: initial project structure"

# Add remote (GitHub)
git remote add origin https://github.com/your-org/api-monitor-saas.git

# Push branches
git push -u origin main
git push -u origin develop
```

---

## Step 3: Environment Configuration

```bash
cd /opt/api-monitor

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env
```

### Required Environment Variables:

```env
# Database (Supabase)
DATABASE_URL="postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres"

# Supabase
SUPABASE_URL="https://[project-ref].supabase.co"
SUPABASE_ANON_KEY="[your-anon-key]"
SUPABASE_SERVICE_ROLE_KEY="[your-service-role-key]"

# Backend
PORT=3001
NODE_ENV=production
JWT_SECRET="generate-a-64-char-random-string-here"
FRONTEND_URL="https://your-domain.com"

# Frontend
NEXT_PUBLIC_API_URL="https://your-domain.com/api"
NEXT_PUBLIC_SUPABASE_URL="https://[project-ref].supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="[your-anon-key]"

# Stripe
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PRICE_BASIC="price_..."
STRIPE_PRICE_PRO="price_..."
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_live_..."

# Email (Resend)
RESEND_API_KEY="re_..."
FROM_EMAIL="alerts@your-domain.com"

# Redis
REDIS_URL="redis://localhost:6379"

# Worker
CHECK_INTERVAL_SECONDS=30
CLEANUP_DAYS=90
```

---

## Step 4: Database Setup (Supabase)

### 4.1 Create Supabase Project
1. Go to https://supabase.com
2. Create new project
3. Copy Project URL and API keys
4. Go to Database → Connection String → URI
5. Copy the connection string

### 4.2 Run Migrations
```bash
cd /opt/api-monitor/backend

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# Verify tables created
npx prisma studio
```

### 4.3 Configure Supabase Auth
1. Go to Authentication → Providers
2. Enable Email provider
3. Configure email templates
4. Set Site URL to your domain
5. Add redirect URLs:
   - `https://your-domain.com/auth/callback`
   - `https://your-domain.com/auth/reset-password`

---

## Step 5: Stripe Configuration

### 5.1 Create Products & Prices
```bash
# In Stripe Dashboard:
# 1. Products → Add Product
#    - Name: "Basic Plan"
#    - Price: $9/month (recurring)
#    - Copy Price ID to STRIPE_PRICE_BASIC
#
# 2. Products → Add Product
#    - Name: "Pro Plan"
#    - Price: $29/month (recurring)
#    - Copy Price ID to STRIPE_PRICE_PRO
```

### 5.2 Configure Webhook
1. Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://your-domain.com/api/v1/billing/webhook`
3. Select events:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
   - `customer.subscription.updated`
4. Copy Webhook Secret to STRIPE_WEBHOOK_SECRET

---

## Step 6: Build & Deploy

### Option A: Docker Deployment (Recommended)
```bash
cd /opt/api-monitor

# Build and start all services
docker compose -f docker-compose.prod.yml up -d --build

# Run database migrations
docker compose -f docker-compose.prod.yml exec -T backend npx prisma migrate deploy

# Check logs
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f worker
docker compose -f docker-compose.prod.yml logs -f frontend

# Health check
curl https://your-domain.com/health
curl https://your-domain.com/api/v1/health
```

### Option B: PM2 Deployment
```bash
cd /opt/api-monitor

# Build all services
npm run build

# Start with PM2
pm2 start backend/dist/server.js --name api-monitor-backend
pm2 start worker/dist/index.js --name api-monitor-worker

# Save PM2 config
pm2 save
pm2 startup

# Monitor
pm2 status
pm2 logs
pm2 monit
```

---

## Step 7: SSL Certificate (Let's Encrypt)

```bash
# Obtain SSL certificate
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Test auto-renewal
sudo certbot renew --dry-run

# Setup auto-renewal cron
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

---

## Step 8: NGINX Configuration

```bash
# Edit Nginx config
sudo nano /etc/nginx/sites-available/api-monitor
```

```nginx
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
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # API
    location /api/ {
        proxy_pass http://localhost:3001/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Static assets caching
    location /_next/static/ {
        proxy_pass http://localhost:3000;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/api-monitor /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## Step 9: Monitoring & Logs

```bash
# View application logs
sudo journalctl -u api-monitor-api -f
sudo journalctl -u api-monitor-worker -f

# View Docker logs
docker logs -f api-monitor-backend-1
docker logs -f api-monitor-worker-1

# Setup log rotation
sudo nano /etc/logrotate.d/api-monitor
```

```
/var/log/api-monitor/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0644 user user
}
```

---

## Step 10: Backup Strategy

```bash
# Add to crontab
crontab -e
```

```
# Daily database backup at 2 AM
0 2 * * * /opt/api-monitor/scripts/backup.sh

# Weekly full backup on Sundays
0 3 * * 0 tar -czf /backups/api-monitor-$(date +\%Y\%m\%d).tar.gz /opt/api-monitor
```

---

## Git Branching Workflow

### Daily Development Flow
```bash
# 1. Start new feature
git checkout develop
git pull origin develop
git checkout -b feature/backend-auth

# 2. Work on feature (make commits)
git add .
git commit -m "feat: implement JWT authentication

- Add auth middleware
- Implement login/signup routes
- Add token refresh"

# 3. Push and create PR
git push origin feature/backend-auth
gh pr create --title "feat: JWT Authentication" --body "Implements user authentication" --base develop

# 4. Code review & merge (via GitHub)
# ... PR reviewed and approved ...
gh pr merge --squash

# 5. Update local develop
git checkout develop
git pull origin develop
```

### Release Flow
```bash
# 1. Create release branch
git checkout develop
git pull origin develop
git checkout -b release/v1.0.0

# 2. Version bump, final testing
# Update version in package.json files
# Run full test suite
# Update CHANGELOG.md

git commit -m "chore: prepare v1.0.0 release"

# 3. Merge to main
git checkout main
git merge release/v1.0.0
git tag -a v1.0.0 -m "Release v1.0.0 - MVP"
git push origin main --tags

# 4. Merge back to develop
git checkout develop
git merge release/v1.0.0
git push origin develop

# 5. Deploy
./scripts/deploy.sh v1.0.0 production
```

### Hotfix Flow
```bash
# 1. Create hotfix from main
git checkout main
git pull origin main
git checkout -b hotfix/critical-fix

# 2. Fix and commit
git commit -m "fix: resolve critical issue"

# 3. Merge to main & tag
git checkout main
git merge hotfix/critical-fix
git tag -a v1.0.1 -m "Hotfix v1.0.1"
git push origin main --tags

# 4. Also merge to develop
git checkout develop
git merge hotfix/critical-fix
git push origin develop
```

---

## Troubleshooting

### Common Issues

**Database connection failed:**
```bash
# Check Supabase connection
psql "$DATABASE_URL" -c "\dt"

# Check firewall
sudo ufw status
```

**Worker not checking monitors:**
```bash
# Check worker logs
pm2 logs api-monitor-worker

# Verify monitors are active
# Check database: SELECT * FROM monitors WHERE is_active = true;
```

**Frontend build fails:**
```bash
# Clear Next.js cache
rm -rf frontend/.next

# Rebuild
npm run build:frontend
```

**Stripe webhook not working:**
```bash
# Test webhook locally
stripe listen --forward-to localhost:3001/api/v1/billing/webhook

# Verify endpoint URL in Stripe Dashboard
```

---

## Quick Reference Commands

```bash
# Start all services (development)
npm run dev

# Start all services (production with Docker)
docker compose -f docker-compose.prod.yml up -d

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Restart services
docker compose -f docker-compose.prod.yml restart

# Database operations
cd backend && npx prisma studio    # GUI
cd backend && npx prisma db push   # Push schema
cd backend && npx prisma migrate dev  # Create migration

# Backup database
pg_dump "$DATABASE_URL" | gzip > backup.sql.gz

# Restore database
gunzip < backup.sql.gz | psql "$DATABASE_URL"
```

---

## Production Checklist

- [ ] SSL certificate installed and auto-renewal configured
- [ ] Firewall configured (only 22, 80, 443 open)
- [ ] Environment variables set correctly
- [ ] Database migrations applied
- [ ] Supabase auth configured
- [ ] Stripe webhooks configured
- [ ] Email (Resend) configured
- [ ] Domain DNS pointing to server
- [ ] Backups scheduled
- [ ] Monitoring/logging configured
- [ ] Health checks passing
- [ ] Rate limiting enabled
- [ ] Security headers configured
- [ ] PM2/Docker auto-restart enabled
