#!/bin/bash
# Force sync local project with GitHub repo (OVERWRITE REMOTE)
# WARNING: This will replace all remote files with local ones

set -e

REPO_URL="https://github.com/dsk-dev-ai/api-monitor-saas.git"

echo "=========================================="
echo " 🔄 FORCE SYNC TO GITHUB"
echo "=========================================="
echo "WARNING: This will OVERWRITE remote files!"
echo ""
read -p "Are you sure? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Cancelled."
    exit 0
fi

# Ensure we're in git repo
if [ ! -d ".git" ]; then
    git init
    git branch -m main
fi

# Set remote
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"

# Stage everything
git add -A

# Commit
git commit -m "feat: release v1.0.0 MVP — complete platform

- Next.js 14 frontend with dashboard, charts, auth
- Express backend with Prisma, Supabase auth, Stripe
- Node.js worker with cron scheduling, email alerts
- Docker deployment with nginx, SSL
- Ubuntu 24.04 server setup guide
- CI/CD with GitHub Actions" || true

# Force push all branches
git push -u origin main --force
git push -u origin develop --force

# Push tags
git tag -a v1.0.0 -m "Release v1.0.0" || true
git push origin v1.0.0 --force

echo ""
echo "✅ Sync complete!"
echo "Visit: https://github.com/dsk-dev-ai/api-monitor-saas"
