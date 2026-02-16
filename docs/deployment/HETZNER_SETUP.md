# Hetzner Deployment Guide

Deploy Brain Web to your Hetzner Cloud server for **€5-12/month**.

**Server Details:**
- IPv4: `178.156.218.126`
- IPv6: `2a01:4ff:f0:591b::/64`

---

## Quick Start (30 minutes)

### Prerequisites
- SSH access to your Hetzner server
- Domain name (optional but recommended)
- GitHub repository access

---

## Step 1: Initial Server Setup

### Connect to Your Server

```bash
ssh root@178.156.218.126
```

### Run Initial Setup Script

Create and run the setup script:

```bash
curl -fsSL https://raw.githubusercontent.com/yourusername/brain-web/main/scripts/hetzner-setup.sh -o setup.sh
chmod +x setup.sh
./setup.sh
```

Or manually:

```bash
# Update system
apt update && apt upgrade -y

# Install essential packages
apt install -y curl git vim htop ufw fail2ban

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
rm get-docker.sh

# Install Docker Compose
apt install -y docker-compose-plugin

# Verify installation
docker --version
docker compose version
```

### Configure Firewall

```bash
# Set up UFW firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8000/tcp  # Backend API (optional: restrict to specific IPs)
ufw --force enable
ufw status
```

### Create Application User (Recommended)

```bash
# Create non-root user
adduser brainweb
usermod -aG sudo brainweb
usermod -aG docker brainweb

# Copy SSH keys
mkdir -p /home/brainweb/.ssh
cp ~/.ssh/authorized_keys /home/brainweb/.ssh/
chown -R brainweb:brainweb /home/brainweb/.ssh
chmod 700 /home/brainweb/.ssh
chmod 600 /home/brainweb/.ssh/authorized_keys

# Switch to new user
su - brainweb
```

---

## Step 2: Deploy Application

### Clone Repository

```bash
cd ~
git clone https://github.com/yourusername/brain-web.git
cd brain-web
```

### Configure Environment

```bash
cp .env.example .env
nano .env
```

**Production `.env` configuration:**

```bash
# Neo4j Configuration
NEO4J_URI=bolt://neo4j:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=<GENERATE_STRONG_PASSWORD>

# PostgreSQL Configuration
POSTGRES_DB=brainweb
POSTGRES_USER=brainweb
POSTGRES_PASSWORD=<GENERATE_STRONG_PASSWORD>

# OpenAI API
OPENAI_API_KEY=<YOUR_OPENAI_KEY>

# Notion Integration (optional)
NOTION_API_KEY=<YOUR_NOTION_KEY>
ENABLE_NOTION_AUTO_SYNC=false

# Backend API
BRAINWEB_API_BASE=http://localhost:8000

# Production settings
NODE_ENV=production
```

**Generate strong passwords:**
```bash
# Generate random passwords
openssl rand -base64 32
```

### Start Services

```bash
# Start all services in detached mode
docker compose up -d

# Check status
docker compose ps

# View logs
docker compose logs -f backend
```

### Verify Services

```bash
# Check all services are running
docker compose ps

# Test backend health
curl http://localhost:8000/health

# Check Neo4j
docker exec -it brainweb-neo4j cypher-shell -u neo4j -p <your-password>
# Run: MATCH (n) RETURN count(n);
# Type :exit to quit
```

---

## Step 3: Set Up Reverse Proxy (Nginx + SSL)

### Install Nginx and Certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### Configure Nginx

Create configuration file:

```bash
sudo nano /etc/nginx/sites-available/brainweb
```

**Basic configuration (HTTP only):**

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name 178.156.218.126;  # Replace with your domain if you have one

    client_max_body_size 100M;

    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket support for voice streaming
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://localhost:8000/health;
        access_log off;
    }
}
```

**Enable the site:**

```bash
sudo ln -s /etc/nginx/sites-available/brainweb /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

**Test:**
```bash
curl http://178.156.218.126/health
```

---

## Step 4: Configure Domain & SSL (Optional but Recommended)

### A. Point Your Domain to Hetzner

In your DNS provider (Cloudflare, Namecheap, etc.):

**Add A Record:**
- **Name:** `api` (or `@` for root domain)
- **Type:** A
- **Value:** `178.156.218.126`
- **TTL:** 300

**Add AAAA Record (IPv6):**
- **Name:** `api` (or `@` for root domain)
- **Type:** AAAA
- **Value:** `2a01:4ff:f0:591b::1`
- **TTL:** 300

### B. Update Nginx Configuration

```bash
sudo nano /etc/nginx/sites-available/brainweb
```

Change `server_name` line:
```nginx
server_name api.yourdomain.com;  # Replace with your actual domain
```

Reload Nginx:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

### C. Get SSL Certificate

```bash
sudo certbot --nginx -d api.yourdomain.com
```

Follow the prompts:
- Enter your email
- Agree to terms
- Choose to redirect HTTP to HTTPS (recommended)

**Test SSL renewal:**
```bash
sudo certbot renew --dry-run
```

Certbot will automatically renew certificates before they expire.

---

## Step 5: Update Frontend

### If Using Vercel

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Update or add:
   ```
   NEXT_PUBLIC_API_URL=https://api.yourdomain.com
   ```
   Or if no domain:
   ```
   NEXT_PUBLIC_API_URL=http://178.156.218.126
   ```
3. Redeploy frontend

### If Self-Hosting Frontend

Add frontend service to your server (see Advanced Setup below).

---

## Step 6: Set Up Backups

### Create Backup Script

```bash
nano ~/backup.sh
```

**Backup script content:**

```bash
#!/bin/bash
BACKUP_DIR=~/backups
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

echo "Starting backup: $DATE"

# Backup Neo4j
echo "Backing up Neo4j..."
docker exec brainweb-neo4j neo4j-admin database dump neo4j --to-path=/tmp 2>/dev/null
docker cp brainweb-neo4j:/tmp/neo4j.dump $BACKUP_DIR/neo4j_$DATE.dump

# Backup PostgreSQL
echo "Backing up PostgreSQL..."
docker exec brainweb-postgres pg_dump -U brainweb brainweb > $BACKUP_DIR/postgres_$DATE.sql

# Backup Qdrant
echo "Backing up Qdrant..."
docker exec brainweb-qdrant tar czf /tmp/qdrant.tar.gz /qdrant/storage 2>/dev/null
docker cp brainweb-qdrant:/tmp/qdrant.tar.gz $BACKUP_DIR/qdrant_$DATE.tar.gz

# Backup environment file
cp ~/brain-web/.env $BACKUP_DIR/env_$DATE.txt

# Keep only last 7 days of backups
find $BACKUP_DIR -type f -mtime +7 -delete

echo "Backup completed: $DATE"
echo "Backup location: $BACKUP_DIR"
```

**Make executable and schedule:**

```bash
chmod +x ~/backup.sh

# Test backup
./backup.sh

# Schedule daily backups at 2 AM
crontab -e
# Add this line:
0 2 * * * /home/brainweb/backup.sh >> /home/brainweb/backup.log 2>&1
```

---

## Step 7: Monitoring & Maintenance

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend
docker compose logs -f neo4j

# Last 100 lines
docker compose logs --tail=100 backend
```

### Check Resource Usage

```bash
# Docker stats
docker stats

# System resources
htop

# Disk usage
df -h
docker system df
```

### Update Application

```bash
cd ~/brain-web

# Pull latest changes
git pull

# Rebuild and restart
docker compose down
docker compose up -d --build

# Or update specific service
docker compose up -d --build backend
```

### Restart Services

```bash
# Restart all
docker compose restart

# Restart specific service
docker compose restart backend
docker compose restart neo4j
```

### Clean Up Docker

```bash
# Remove unused images
docker image prune -a

# Remove unused volumes (CAREFUL!)
docker volume prune

# Full cleanup
docker system prune -a --volumes
```

---

## Cost Breakdown

**Hetzner Cloud CX21 (Recommended):**
- 2 vCPU, 4GB RAM, 40GB SSD
- **Cost:** €4.90/month (~$5.30/month)
- Includes: 20TB traffic

**If you need more power (CX31):**
- 2 vCPU, 8GB RAM, 80GB SSD
- **Cost:** €8.90/month (~$9.60/month)

**Total Infrastructure Cost:**
- **Hetzner:** €4.90-8.90/month
- **Domain:** ~$12/year
- **Total:** ~€6-10/month

**Comparison:**
- Railway: $8-15/month
- AWS: $70+/month
- Vercel + Railway: $20+/month

---

## Troubleshooting

### Services Won't Start

```bash
# Check logs
docker compose logs

# Check specific service
docker compose logs backend

# Restart services
docker compose restart

# Full restart
docker compose down
docker compose up -d
```

### Out of Memory

```bash
# Add swap space
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Verify
free -h
```

### Port Already in Use

```bash
# Check what's using port 8000
sudo lsof -i :8000
sudo netstat -tulpn | grep 8000

# Kill process if needed
sudo kill -9 <PID>
```

### SSL Certificate Issues

```bash
# Check certificate status
sudo certbot certificates

# Renew manually
sudo certbot renew

# Test renewal
sudo certbot renew --dry-run
```

### Database Connection Issues

```bash
# Check if services are running
docker compose ps

# Check Neo4j logs
docker compose logs neo4j

# Test Neo4j connection
docker exec -it brainweb-neo4j cypher-shell -u neo4j -p <password>

# Check PostgreSQL
docker exec -it brainweb-postgres psql -U brainweb -d brainweb
```

---

## Security Checklist

- ✅ Strong passwords in `.env` (use `openssl rand -base64 32`)
- ✅ UFW firewall enabled
- ✅ SSH key authentication (disable password auth)
- ✅ Fail2ban installed and configured
- ✅ Regular backups scheduled
- ✅ SSL/TLS enabled (if using domain)
- ✅ Keep system updated: `sudo apt update && sudo apt upgrade`
- ✅ Monitor logs regularly
- ✅ Restrict database ports (only accessible via Docker network)

### Disable Password SSH (After SSH Keys Work)

```bash
sudo nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no
sudo systemctl restart sshd
```

---

## Advanced: Self-Host Frontend on Same Server

If you want to host the Next.js frontend on the same server:

### 1. Build Frontend Docker Image

Add to `docker-compose.yml`:

```yaml
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: brainweb-frontend
    restart: unless-stopped
    environment:
      - NEXT_PUBLIC_API_URL=http://backend:8000
    ports:
      - "3000:3000"
    depends_on:
      - backend
```

### 2. Create Frontend Dockerfile

`frontend/Dockerfile`:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["npm", "start"]
```

### 3. Update Nginx

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:8000;
        # ... same proxy settings as before
    }
}
```

---

## Next Steps

1. ✅ SSH into your server: `ssh root@178.156.218.126`
2. ✅ Run initial setup (Step 1)
3. ✅ Deploy application (Step 2)
4. ✅ Set up Nginx (Step 3)
5. ⏳ Configure domain & SSL (Step 4) - Optional
6. ⏳ Set up backups (Step 6)
7. ⏳ Update frontend to point to new backend

---

## Support

**Common Commands:**
```bash
# View all services
docker compose ps

# View logs
docker compose logs -f

# Restart
docker compose restart

# Update
cd ~/brain-web && git pull && docker compose up -d --build

# Backup
~/backup.sh
```

**Need help?** Check the logs first:
```bash
docker compose logs -f backend
```
