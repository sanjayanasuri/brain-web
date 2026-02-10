# Quick Start: Deploy to Hetzner

**Server IP:** `178.156.218.126`

## 🚀 Fast Track (Copy & Paste)

### 1. SSH into your server
```bash
ssh root@178.156.218.126
```

### 2. Run automated setup
```bash
curl -fsSL https://raw.githubusercontent.com/yourusername/brain-web/main/scripts/hetzner-setup.sh -o setup.sh
chmod +x setup.sh
./setup.sh
```

Or manually:
```bash
# Update & install Docker
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin

# Configure firewall
ufw allow ssh && ufw allow 80 && ufw allow 443 && ufw allow 8000
ufw --force enable
```

### 3. Switch to app user & clone repo
```bash
su - brainweb
git clone https://github.com/yourusername/brain-web.git
cd brain-web
```

### 4. Configure environment
```bash
cp .env.production .env
nano .env
```

**Required changes in `.env`:**
- Set `NEO4J_PASSWORD` (generate with: `openssl rand -base64 32`)
- Set `POSTGRES_PASSWORD` (generate with: `openssl rand -base64 32`)
- Set `OPENAI_API_KEY` (your OpenAI API key)
- Set `API_TOKEN_SECRET` (generate with: `openssl rand -hex 32`)

### 5. Deploy
```bash
./scripts/deploy.sh
```

### 6. Set up Nginx reverse proxy
```bash
# Install Nginx
sudo apt install -y nginx

# Copy config
sudo cp scripts/nginx-brainweb.conf /etc/nginx/sites-available/brainweb

# Update server_name in config
sudo nano /etc/nginx/sites-available/brainweb
# Change: server_name _; 
# To:     server_name 178.156.218.126;  (or your domain)

# Enable site
sudo ln -s /etc/nginx/sites-available/brainweb /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 7. Test
```bash
curl http://178.156.218.126/health
```

---

## 📋 Optional: SSL Certificate (if using domain)

### Point domain to server
In your DNS provider:
- Add A record: `api.yourdomain.com` → `178.156.218.126`

### Get SSL certificate
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.yourdomain.com
```

---

## 🔧 Useful Commands

```bash
# View logs
docker compose logs -f backend

# Restart services
docker compose restart

# Update application
cd ~/brain-web && git pull && ./scripts/deploy.sh

# Backup databases
./scripts/backup.sh

# Check status
docker compose ps
```

---

## 📊 Update Frontend

If using Vercel, update environment variable:
```
NEXT_PUBLIC_API_URL=http://178.156.218.126
```
Or with domain:
```
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

---

## 📖 Full Documentation

See [HETZNER_SETUP.md](./HETZNER_SETUP.md) for complete documentation.

---

## 💰 Cost

- **Hetzner CX21:** €4.90/month
- **Domain (optional):** ~$12/year
- **Total:** ~€5-6/month

Compare to:
- Railway: $8-15/month
- AWS: $70+/month
