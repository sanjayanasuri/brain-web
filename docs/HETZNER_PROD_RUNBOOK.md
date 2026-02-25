# Brain Web Hetzner Production Runbook

## 1) Server baseline (one-time)

- Ubuntu 22.04/24.04 LTS
- Create non-root sudo user
- SSH keys only
- Disable root SSH login + password auth
- UFW allow only: 22, 80, 443
- Install Docker + Compose plugin

## 2) App deploy

```bash
cd /opt
sudo git clone https://github.com/sanjayanasuri/brain-web.git
cd brain-web
sudo cp .env.production .env
# Fill real secrets in .env
sudo docker compose -f docker-compose.prod.yml up -d --build
```

## 3) Reverse proxy (recommended)

Expose only HTTPS publicly. Keep app containers private.

- Run Caddy/Nginx on host
- Route `/:443` -> `127.0.0.1:3000`
- Route `/api/*` -> `127.0.0.1:8000`
- Enable TLS + auto renew

## 4) OpenClaw placement strategy

- **VPS**: always-on assistant + scheduled jobs + reminders
- **Mac**: local integrations/dev tasks

If exposing OpenClaw control UI via reverse proxy, set `gateway.trustedProxies` in `~/.openclaw/openclaw.json` on that host.

## 5) Backups (required)

- Nightly Postgres dump to object storage
- Neo4j + Qdrant volume snapshot schedule
- Weekly restore test to separate environment

## 6) Monitoring

- Uptime check: `/health` backend, `/` frontend
- Error tracking: Sentry
- Basic alerts: downtime + restart storm

## 7) Safe rollout flow

1. Push to `main`
2. Deploy to staging first
3. Smoke test critical paths
4. Promote to production

## 8) Commands I recommend using

```bash
# Health
openclaw status --deep
openclaw security audit --deep

# App
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend
```
