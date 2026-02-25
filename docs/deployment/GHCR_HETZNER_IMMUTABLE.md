# GHCR + Hetzner Immutable Deploy (Recommended)

This deployment path builds runtime images in GitHub Actions and deploys them on Hetzner by image tag.

Why this is better than `git pull` on prod:

- no dirty working-tree failures blocking deploys
- easier rollback (`IMAGE_TAG=<old-sha>`)
- clear mapping from container -> commit SHA
- faster deploys on the server (pull + restart instead of full rebuilds)

## What was added

- Workflow: `.github/workflows/deploy-ghcr-hetzner.yml`
- Compose override: `docker-compose.ghcr.yml`
- Server deploy script: `scripts/deploy-ghcr.sh`

## Required GitHub Secrets

- `HETZNER_HOST`
- `HETZNER_USER`
- `HETZNER_SSH_KEY`
- `GHCR_PULL_USERNAME`
- `GHCR_PULL_TOKEN`

### GHCR pull token notes

- Create a GitHub personal access token (classic or fine-grained) that can read GHCR packages for this repo owner.
- Store it as `GHCR_PULL_TOKEN`.
- `GHCR_PULL_USERNAME` is usually your GitHub username.

## Server prep (one-time)

On Hetzner, ensure the repo contains the latest deployment scripts/config files:

```bash
cd /root/brain-web
git pull --ff-only
chmod +x scripts/deploy-ghcr.sh
```

## How deploy works

1. GitHub Actions builds/pushes:
   - `ghcr.io/<owner>/brain-web-backend:<sha>`
   - `ghcr.io/<owner>/brain-web-frontend:<sha>`
2. Workflow SSHes into Hetzner
3. Server runs:
   - `docker login ghcr.io`
   - `./scripts/deploy-ghcr.sh` with `IMAGE_TAG=<sha>`
4. Compose pulls tagged images and restarts only runtime app containers

## Rollback example

```bash
cd /root/brain-web
GHCR_PULL_USERNAME=... GHCR_PULL_TOKEN=... IMAGE_TAG=<old-commit-sha> ./scripts/deploy-ghcr.sh
```

## Migration plan

1. Add the required GHCR pull secrets in GitHub.
2. Let `.github/workflows/deploy-ghcr-hetzner.yml` run successfully once.
3. Disable or remove the old mutable deploy workflow (`.github/workflows/deploy.yml`) once you trust the GHCR path.
