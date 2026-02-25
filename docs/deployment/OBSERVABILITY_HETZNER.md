# Hetzner Observability (Logs + Metrics)

This repo includes a lightweight observability stack for your Hetzner host:

- `Grafana` (dashboard UI)
- `Loki` (central log store)
- `Promtail` (collects Docker container logs)
- `Prometheus` (metrics)
- `cAdvisor` (container metrics)
- `node_exporter` (host metrics)

Files live under `ops/observability/`.

## What you get

- One place to search logs from `frontend`, `backend`, `postgres`, `neo4j`, `redis`, etc.
- Host + container metrics for CPU, memory, disk, restarts
- Grafana as the single UI for day-to-day debugging

## Quick Start on Hetzner

1. SSH into the server.
2. From the repo root, create a small env file for Grafana credentials:

```bash
cd /root/brain-web
mkdir -p ops/observability
cat > ops/observability/.env <<'EOF'
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=replace-this
EOF
```

3. Start the observability stack:

```bash
docker compose -f ops/observability/docker-compose.yml --env-file ops/observability/.env up -d
```

4. Open Grafana through Nginx (recommended):

- `https://demo.sanjayanasuri.com/ops/grafana/`

If you do not add the reverse-proxy route yet, you can still access Grafana via SSH tunnel because the observability compose stack binds ports to `127.0.0.1` only.

Example tunnel:

```bash
ssh -L 3001:127.0.0.1:3001 root@your-server
```

Then open:

- `http://127.0.0.1:3001`

## Basic Grafana Queries (Loki)

- All backend logs:
  - `{container="brainweb-backend"}`
- Errors across all containers:
  - `{job="docker"} |= "ERROR"`
- Container restarts / crash traces:
  - `{job="docker"} |= "Traceback"`

## Important: Browser Runtime Errors (Frontend UI)

Loki/Promtail collects container logs, but **browser runtime errors do not automatically appear in Docker logs**.

To capture frontend/iPad runtime errors (JS exceptions, React errors, network failures), add a browser error tracker such as:

- `Sentry` (recommended)

Recommended setup:

- Frontend (Next.js): Sentry browser + server instrumentation
- Backend (FastAPI): Sentry Python SDK for exceptions
- Link Sentry alerts into Slack/Discord/email
- Use Grafana/Loki for infrastructure + container logs

## Vercel Frontend Logs → Loki (Log Drains)

If your **frontend runs on Vercel**, you can ship Vercel runtime logs into Loki so Grafana becomes the single place to search backend + Vercel logs.

1. Configure the backend ingest secret on your Hetzner backend (and redeploy/restart):
   - `VERCEL_LOG_DRAIN_SECRET=...`
2. In Vercel Dashboard → Project → Settings → Log Drains:
   - URL: `https://<your-backend-host>/observability/vercel/logs`
     - If your Nginx routes the backend under `/api`, use: `https://<your-backend-host>/api/observability/vercel/logs`
   - Enable **Sign requests** and use the same secret.
3. Query in Grafana (Loki):
   - Vercel drain payloads:
     - `{container="brainweb-backend"} | json | event="vercel_log"`

## LLM Incident Loop ("Ralph Wiggum loop") - Safe version

Start with a read-only triage bot:

1. Alert fires (Grafana/Sentry)
2. Bot fetches:
   - recent Loki logs
   - Prometheus metrics snapshot
   - latest deploy SHA
3. LLM summarizes:
   - likely cause
   - impacted services
   - recommended action
4. Human approves action

Only after that should you automate safe actions (restart one container, rollback image tag).

## Unified Incident Feed (Local Agent)

This repo includes a small read-only incident poller you can run locally:

```bash
python scripts/incident_loop.py --watch
```

It polls Loki + Sentry (if configured), dedupes into a small SQLite file, and writes incident JSON files under:

- `ops/incident_loop/outbox`

## Notes

- `promtail` currently tails Docker logs via the Docker socket.
- If you also want systemd/journald logs (e.g. Docker daemon/service logs), add a journald scrape config and mount `/var/log/journal`.
- This stack is configured to bind Grafana/Loki/Prometheus/node_exporter/cAdvisor to `127.0.0.1` only (recommended default).
- If you copy files from macOS to Linux, remove `._*` sidecar files in `ops/observability/` because Grafana provisioning may try to parse them and fail.
