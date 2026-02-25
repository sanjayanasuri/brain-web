# Adopting OpenClaw for Brain Web

OpenClaw is the gateway + coding-agent stack (worktrees, Pi agent, multi-channel). This doc gets Brain Web running as the **agent workspace** so the assistant operates on this repo.

## 1. Install OpenClaw

**macOS / Linux (recommended):**
```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

**Or with Node 22+ already:**
```bash
npm install -g openclaw@latest
openclaw onboard --install-daemon
```

## 2. Point the workspace at Brain Web

OpenClaw uses one workspace directory (default `~/.openclaw/workspace`). To use this repo:

1. Open (or create) `~/.openclaw/openclaw.json` (JSON5: comments and trailing commas allowed).
2. Set the agent workspace to the **absolute path** of the brain-web repo:

```json5
{
  "agents": {
    "defaults": {
      "workspace": "/absolute/path/to/brain-web"
    }
  }
}
```

Replace `/absolute/path/to/brain-web` with the real path (e.g. on macOS something like `/Users/you/brain-web`). Use `pwd` from inside the repo to get it.

3. Restart the gateway so the config is picked up:
   ```bash
   openclaw gateway status   # see if it's running
   # If using the daemon, restart the service; otherwise:
   openclaw gateway --port 18789
   ```

## 3. Workspace files in this repo

When the workspace is brain-web, OpenClaw loads these from the repo root:

- **AGENTS.md** – Already present; Brain Web agent preferences (engineering defaults, web search). OpenClaw uses this as the main agent instructions.
- **SOUL.md**, **USER.md**, **TOOLS.md**, **HEARTBEAT.md** – Optional. If you want OpenClaw to seed them, run from the repo:  
  `openclaw setup --workspace "$(pwd)"`  
  (It will add only missing files.)

So you can keep using the existing AGENTS.md; no need to duplicate it elsewhere.

## 4. Chat and dashboard

- **Browser UI:** `openclaw dashboard` (or open http://127.0.0.1:18789/ when the gateway is running).
- **CLI chat:** `openclaw chat` (if configured).
- Pair WhatsApp/Telegram/Discord etc. via `openclaw channels login` and the Control UI.

## 5. How this fits with .clawdbot (Zoe-lite)

- **OpenClaw** = the agent runtime and channels (one gateway, Pi/coding agent, worktrees when it runs coding tasks). The agent’s “home” is brain-web when workspace is set as above.
- **.clawdbot** = local scripts for task registry, ideas queue, scout, dispatch, and “merge-ready” checks. They don’t require OpenClaw.

You can:
- Use **only OpenClaw** (no .clawdbot): chat from the Control UI or channels; the agent edits in brain-web.
- Use **both**: run `.clawdbot/scripts/scout.sh --run` and `dispatch.sh` / `check.sh` as before; have OpenClaw run the agent for chat and coding, and keep using the ideas queue and PR-ready notifications from .clawdbot.

## 6. References

- [OpenClaw docs](https://docs.openclaw.ai/)
- [Getting started](https://docs.openclaw.ai/start/getting-started)
- [Agent workspace](https://docs.openclaw.ai/concepts/agent-workspace)
- [Configuration reference](https://docs.openclaw.ai/gateway/configuration-reference)
