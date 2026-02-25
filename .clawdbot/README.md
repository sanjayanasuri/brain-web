# .clawdbot (Zoe-lite orchestration)

This folder runs a deterministic multi-agent coding loop on top of OpenClaw.

## Core files

- `ideas.json` — proposed/approved work items
- `active-tasks.json` — runtime task registry
- `scripts/spawn.sh` — creates worktree + tmux session + registry entry
- `scripts/dispatch.sh` — starts approved ideas
- `scripts/check.sh` — monitors tmux/PR/CI and marks merge-ready
- `scripts/notify.sh` — sends readiness notifications
- `check-agents.sh` — convenience wrapper around `scripts/check.sh`

## Task lifecycle

`proposed -> approved -> building -> running -> ready`

`running -> failed` when tmux dies and retries are exhausted.

## Monitoring loop

Run periodically (e.g. every 10 min):

```bash
.clawdbot/check-agents.sh
```

What it does:

1. checks tmux session is alive
2. checks PR existence by branch (`gh pr list --head`)
3. checks CI status (`gh pr checks`)
4. checks mergeability (`gh pr view --json mergeStateStatus`)
5. marks task `ready` only when all gates pass

## Notifications

`scripts/notify.sh` tries, in order:

1. Telegram bot API (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`)
2. `openclaw system event --mode now`
3. stdout fallback

## Retry behavior

If tmux dies before PR creation, checker auto-respawns the session with `prompts/retry.md`.

Tune max retries with:

```bash
export CLAWDBOT_MAX_RETRIES=3
```

## Example cron

```bash
*/10 * * * * cd /Users/sanjayanasuri/brain-web && ./.clawdbot/check-agents.sh >> /tmp/clawdbot-check.log 2>&1
```
