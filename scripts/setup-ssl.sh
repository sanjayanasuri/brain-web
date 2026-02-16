#!/bin/bash

# Brain Web - SSL Setup Script
# Sets up Let's Encrypt SSL certificate for demo.sanjayanasuri.com

set -e

DOMAIN="demo.sanjayanasuri.com"
EMAIL="sanjay@sanjayanasuri.com"  # Update this to your email

echo "=========================================="
echo "Brain Web - SSL Certificate Setup"
echo "Domain: $DOMAIN"
echo "=========================================="

# Step 1: Install Certbot
echo ""
echo "Step 1: Installing Certbot..."
sudo apt update
sudo apt install -y certbot python3-certbot-nginx

# Step 2: Stop nginx if running
echo ""
echo "Step 2: Stopping Nginx..."
sudo systemctl stop nginx || true

# Step 3: Obtain SSL certificate
echo ""
echo "Step 3: Obtaining SSL certificate..."
sudo certbot certonly --standalone \
  --non-interactive \
  --agree-tos \
  --email "$EMAIL" \
  -d "$DOMAIN"

# Step 4: Update Nginx configuration
echo ""
echo "Step 4: Updating Nginx configuration..."
sudo cp /Users/sanjayanasuri/brain-web/brain-web/scripts/nginx-brainweb.conf /etc/nginx/sites-available/brainweb

# Step 5: Test Nginx configuration
echo ""
echo "Step 5: Testing Nginx configuration..."
sudo nginx -t

# Step 6: Start Nginx
echo ""
echo "Step 6: Starting Nginx..."
sudo systemctl start nginx
sudo systemctl enable nginx

# Step 7: Set up auto-renewal
echo ""
echo "Step 7: Setting up SSL auto-renewal..."
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

# Step 8: Test renewal
echo ""
echo "Step 8: Testing certificate renewal..."
sudo certbot renew --dry-run

echo ""
echo "=========================================="
echo "SSL Setup Complete!"
echo "=========================================="
echo ""
echo "Your site is now available at:"
echo "  https://$DOMAIN"
echo ""
echo "Certificate will auto-renew before expiration."
echo "Check renewal status: sudo certbot renew --dry-run"
echo ""
