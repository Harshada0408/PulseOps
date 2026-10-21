#!/bin/bash
# API Monitor SaaS — Git Repository Setup & Sync Script
# Run this in your Ubuntu VS Code terminal

set -e

REPO_URL="https://github.com/dsk-dev-ai/api-monitor-saas.git"
PROJECT_DIR="$HOME/Projects/api-monitor-saas-v1"

echo "=========================================="
echo " API Monitor SaaS v1.0 — Git Setup"
echo "=========================================="

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if we're in the right directory
if [ ! -f "$PROJECT_DIR/package.json" ]; then
    error "Project directory not found at $PROJECT_DIR"
    error "Please run this script from your project root"
    exit 1
fi

cd "$PROJECT_DIR"

# Step 1: Initialize Git if not already
echo ""
log "Step 1: Initializing Git repository..."
if [ ! -d ".git" ]; then
    git init
    git branch -m main
    success "Git repository initialized"
else
    warn "Git repository already exists"
fi

# Step 2: Configure Git remotes
echo ""
log "Step 2: Configuring Git remotes..."
if git remote get-url origin &>/dev/null; then
    warn "Remote 'origin' already exists"
    git remote set-url origin "$REPO_URL"
    success "Remote URL updated"
else
    git remote add origin "$REPO_URL"
    success "Remote 'origin' added: $REPO_URL"
fi

# Step 3: Check Git identity
echo ""
log "Step 3: Checking Git identity..."
if [ -z "$(git config user.name)" ] || [ -z "$(git config user.email)" ]; then
    warn "Git identity not configured"
    echo "Please configure:"
    echo "  git config user.name 'Your Name'"
    echo "  git config user.email 'your@email.com'"
    exit 1
fi
success "Git identity: $(git config user.name) <$(git config user.email)>"

# Step 4: Create .gitignore if missing
echo ""
log "Step 4: Checking .gitignore..."
if [ ! -f ".gitignore" ]; then
    cat > .gitignore << 'EOF'
# Dependencies
node_modules/
.pnp
.pnp.js

# Environment
.env
.env.local
.env.*.local

# Build
.next/
dist/
build/
*.tsbuildinfo

# Logs
logs/
*.log
npm-debug.log*

# IDE
.vscode/
.idea/
*.swp

# OS
.DS_Store
Thumbs.db

# Database
*.db
*.sqlite

# Docker
.dockerignore

# Coverage
coverage/

# Misc
*.pem
*.key
EOF
    success ".gitignore created"
else
    success ".gitignore exists"
fi

# Step 5: Stage all files
echo ""
log "Step 5: Staging files..."
git add -A
success "All files staged"

# Step 6: Show status
echo ""
log "Step 6: Git status:"
git status --short

# Step 7: Commit
echo ""
log "Step 7: Creating initial commit..."
if git diff --cached --quiet; then
    warn "No changes to commit"
else
    git commit -m "feat: release v1.0.0 MVP

Complete production-ready API monitoring platform:
- Next.js 14 frontend with real-time dashboard
- Express backend with Prisma ORM
- Node.js worker for health checks
- Supabase authentication
- Stripe billing integration
- Email alerts via Resend
- Public status pages
- Docker deployment
- Ubuntu 24.04 support
- CI/CD with GitHub Actions"
    success "Initial commit created"
fi

# Step 8: Create branches
echo ""
log "Step 8: Setting up branches..."

# Create develop branch if not exists
if ! git show-ref --verify --quiet refs/heads/develop; then
    git checkout -b develop
    success "Branch 'develop' created"
else
    git checkout develop
    success "Switched to 'develop' branch"
fi

# Create feature branches
for branch in feature/backend-core feature/worker-service feature/frontend-dashboard feature/integration-testing feature/stripe-billing; do
    if ! git show-ref --verify --quiet refs/heads/$branch; then
        git branch $branch
        success "Branch '$branch' created"
    else
        warn "Branch '$branch' already exists"
    fi
done

# Step 9: Push to remote
echo ""
log "Step 9: Pushing to remote..."
echo "You'll need to authenticate with GitHub..."

# Check if gh CLI is installed
if command -v gh &> /dev/null; then
    if ! gh auth status &>/dev/null; then
        log "Authenticating with GitHub CLI..."
        gh auth login
    fi
fi

# Push main branch
git checkout main
if git push -u origin main 2>/dev/null; then
    success "Pushed 'main' to origin"
else
    warn "Failed to push 'main'. You may need to:"
    echo "  1. Authenticate: gh auth login"
    echo "  2. Or use: git push -u origin main --force"
fi

# Push develop branch
git checkout develop
if git push -u origin develop 2>/dev/null; then
    success "Pushed 'develop' to origin"
else
    warn "Failed to push 'develop'"
fi

# Push feature branches
for branch in feature/backend-core feature/worker-service feature/frontend-dashboard feature/integration-testing feature/stripe-billing; do
    if git push -u origin $branch 2>/dev/null; then
        success "Pushed '$branch' to origin"
    else
        warn "Failed to push '$branch'"
    fi
done

# Step 10: Create Release Tag
echo ""
log "Step 10: Creating release tag v1.0.0..."
git checkout main
if git tag -a v1.0.0 -m "Release v1.0.0 — MVP

Production-ready API monitoring SaaS with:
- Full-stack Next.js + Express application
- Real-time monitoring & alerting
- Stripe subscription billing
- Docker deployment ready
- Ubuntu 24.04 server setup" 2>/dev/null; then
    git push origin v1.0.0
    success "Tag v1.0.0 created and pushed"
else
    warn "Tag v1.0.0 already exists"
fi

# Step 11: Summary
echo ""
echo "=========================================="
echo " ✅ Git Setup Complete!"
echo "=========================================="
echo ""
echo "Repository: $REPO_URL"
echo "Local path: $PROJECT_DIR"
echo ""
echo "Branches:"
git branch -a
echo ""
echo "Tags:"
git tag -l
echo ""
echo "Next steps:"
echo "  1. Configure .env file with your credentials"
echo "  2. Run: docker compose up -d"
echo "  3. Visit: http://localhost:3000"
echo ""
echo "GitHub Release:"
echo "  https://github.com/dsk-dev-ai/api-monitor-saas/releases/tag/v1.0.0"
echo ""
