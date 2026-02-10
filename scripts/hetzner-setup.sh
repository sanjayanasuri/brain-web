#!/bin/bash
#
# Hetzner Server Initial Setup Script
# This script sets up a fresh Hetzner server for Brain Web deployment
#
# Usage: curl -fsSL https://raw.githubusercontent.com/yourusername/brain-web/main/scripts/hetzner-setup.sh | bash
# Or: ./hetzner-setup.sh

set -e

echo "=========================================="
echo "Brain Web - Hetzner Server Setup"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (use sudo)"
    exit 1
fi

echo "Step 1: Updating system packages..."
apt update && apt upgrade -y

echo ""
echo "Step 2: Installing essential packages..."
apt install -y \
    curl \
    git \
    vim \
    htop \
    ufw \
    fail2ban \
    ca-certificates \
    gnupg \
    lsb-release

echo ""
echo "Step 3: Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    echo "Docker installed successfully"
else
    echo "Docker already installed"
fi

echo ""
echo "Step 4: Installing Docker Compose..."
if ! docker compose version &> /dev/null; then
    apt install -y docker-compose-plugin
    echo "Docker Compose installed successfully"
else
    echo "Docker Compose already installed"
fi

echo ""
echo "Step 5: Configuring firewall (UFW)..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8000/tcp
ufw --force enable

echo ""
echo "Step 6: Configuring Fail2ban..."
systemctl enable fail2ban
systemctl start fail2ban

echo ""
echo "Step 7: Creating application user..."
if id "brainweb" &>/dev/null; then
    echo "User 'brainweb' already exists"
else
    adduser --disabled-password --gecos "" brainweb
    usermod -aG sudo brainweb
    usermod -aG docker brainweb
    
    # Copy SSH keys if they exist
    if [ -d ~/.ssh ]; then
        mkdir -p /home/brainweb/.ssh
        cp ~/.ssh/authorized_keys /home/brainweb/.ssh/ 2>/dev/null || true
        chown -R brainweb:brainweb /home/brainweb/.ssh
        chmod 700 /home/brainweb/.ssh
        chmod 600 /home/brainweb/.ssh/authorized_keys 2>/dev/null || true
    fi
    
    echo "User 'brainweb' created successfully"
fi

echo ""
echo "Step 8: Enabling automatic security updates..."
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

echo ""
echo "Step 9: Optimizing system for Docker..."
# Add swap if not exists
if [ ! -f /swapfile ]; then
    echo "Creating 2GB swap file..."
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Docker daemon optimization
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
systemctl restart docker

echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Switch to brainweb user: su - brainweb"
echo "2. Clone repository: git clone https://github.com/yourusername/brain-web.git"
echo "3. Follow HETZNER_SETUP.md for deployment"
echo ""
echo "System Information:"
echo "- Docker version: $(docker --version)"
echo "- Docker Compose version: $(docker compose version)"
echo "- UFW status: $(ufw status | head -1)"
echo "- Swap: $(free -h | grep Swap)"
echo ""
echo "You can now SSH as: ssh brainweb@$(hostname -I | awk '{print $1}')"
echo ""
