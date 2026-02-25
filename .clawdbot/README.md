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
5. checks approval count gate (`CLAWDBOT_MIN_APPROVALS`, default `1`)
6. if UI files changed, checks PR body includes screenshot evidence
7. marks task `ready` only when all gates pass

## Notifications

`scripts/notify.sh` tries, in order:

1. iMessage via `imsg` (`IMSG_TO`)
2. Telegram bot API (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`)
3. `openclaw system event --mode now`
4. stdout fallback

## Retry behavior

If tmux dies before PR creation, checker auto-respawns the session with `prompts/retry.md`.

Tune max retries with:

```bash
export CLAWDBOT_MAX_RETRIES=3
```

## Gates/tuning

```bash
export CLAWDBOT_MAX_RETRIES=3
export CLAWDBOT_MIN_APPROVALS=3
export CLAWDBOT_REQUIRE_UI_SCREENSHOT=true
```

## One-command tick

```bash
./.clawdbot/scripts/swarm-start.sh
```

## Daily digest

```bash
./.clawdbot/scripts/ops-digest.sh
```

## Example cron

```bash
./.clawdbot/scripts/install-cron.sh "*/10 * * * *"
# or manually:
# */10 * * * * cd /Users/sanjayanasuri/brain-web && ./.clawdbot/check-agents.sh >> /tmp/clawdbot-check.log 2>&1
```
