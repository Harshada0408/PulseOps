#!/bin/bash
# API Monitor SaaS - Ubuntu 24.04 LTS Setup Script
# Run as: bash scripts/setup-ubuntu.sh

set -e

echo "========================================"
echo " API Monitor SaaS - Ubuntu 24.04 Setup"
echo "========================================"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Update system
log "Updating system packages..."
sudo apt update && sudo apt upgrade -y
success "System updated"

# Install essential packages
log "Installing essential packages..."
sudo apt install -y curl wget git build-essential software-properties-common \
    apt-transport-https ca-certificates gnupg lsb-release nginx ufw
success "Essential packages installed"

# Install Node.js 22 LTS
log "Installing Node.js 22 LTS..."
if ! command -v node &> /dev/null || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" != "22" ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs
fi
success "Node.js $(node -v) installed"

# Verify npm
log "npm version: $(npm -v)"

# Install PM2
log "Installing PM2..."
sudo npm install -g pm2
success "PM2 installed"

# Install Docker
log "Installing Docker..."
if ! command -v docker &> /dev/null; then
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
        sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt update
    sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    sudo usermod -aG docker $USER
    success "Docker installed"
else
    success "Docker already installed"
fi

# Install GitHub CLI
log "Installing GitHub CLI..."
if ! command -v gh &> /dev/null; then
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
    sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | \
        sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
    sudo apt update && sudo apt install gh -y
    success "GitHub CLI installed"
fi

# Setup firewall
log "Configuring UFW firewall..."
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3000/tcp
sudo ufw allow 3001/tcp
sudo ufw --force enable
success "Firewall configured"

# Create project directory
PROJECT_DIR="/opt/api-monitor"
log "Creating project directory: $PROJECT_DIR"
sudo mkdir -p $PROJECT_DIR
sudo chown $USER:$USER $PROJECT_DIR

# Setup log directories
sudo mkdir -p /var/log/api-monitor
sudo chown $USER:$USER /var/log/api-monitor

# Setup systemd services
log "Creating systemd services..."

sudo tee /etc/systemd/system/api-monitor-api.service > /dev/null <<EOF
[Unit]
Description=API Monitor API Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_DIR/backend
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=$PROJECT_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/api-monitor-worker.service > /dev/null <<EOF
[Unit]
Description=API Monitor Worker
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_DIR/worker
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=$PROJECT_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
success "Systemd services created"

# Install SSL (Let's Encrypt)
log "Installing Certbot..."
sudo apt install -y certbot python3-certbot-nginx
success "Certbot installed"

# Summary
echo ""
echo "========================================"
echo " Setup Complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Clone your repository to $PROJECT_DIR"
echo "  2. Copy .env.example to .env and configure"
echo "  3. Run: cd $PROJECT_DIR && npm install"
echo "  4. Run: npm run db:push"
echo "  5. Run: npm run build"
echo "  6. Start services: sudo systemctl start api-monitor-api api-monitor-worker"
echo ""
echo "SSL Setup:"
echo "  sudo certbot --nginx -d your-domain.com"
echo ""
echo "Docker Deployment:"
echo "  docker compose -f docker-compose.prod.yml up -d"
echo ""
