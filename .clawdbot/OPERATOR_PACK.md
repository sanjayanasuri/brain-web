# Bujji Operator Pack

Use this to drive Bujji with minimal typing.

## Command format (default)

```text
MODE: builder | teacher
DO: <the outcome you want>
CONSTRAINTS: <hard limits>
DONE WHEN: <objective finish line>
```

Example:

```text
MODE: builder
DO: Ship scheduler reliability fixes to production.
CONSTRAINTS: no schema migrations, no UI changes, keep API backward-compatible.
DONE WHEN: PR merged, deploy complete, /api/health=200.
```

---

## Modes

- **builder** → execute, minimal chatter, report blockers + milestones
- **teacher** → explain decisions, alternatives, and tradeoffs

---

## Update policy (recommended)

Use this as your default instruction to Bujji:

```text
Update cadence:
- send one message when started
- send only on milestone, blocker, or completion
- no step-by-step spam
```

---

## Production defaults

Swarm runtime defaults live in `.clawdbot/.env`:

- `CLAWDBOT_MIN_APPROVALS=3`
- `CLAWDBOT_REQUIRE_UI_SCREENSHOT=true`
- `IMSG_TO=5105579218`

---

## High-leverage one-liners

### 1) Start swarm tick

```bash
cd /Users/sanjayanasuri/brain-web && ./.clawdbot/scripts/swarm-start.sh
```

### 2) Monitor task state

```bash
cd /Users/sanjayanasuri/brain-web && cat .clawdbot/active-tasks.json | jq
```

### 3) Install checker cron (every 10 min)

```bash
cd /Users/sanjayanasuri/brain-web && ./.clawdbot/scripts/install-cron.sh "*/10 * * * *"
```

### 4) Daily operator digest

```bash
cd /Users/sanjayanasuri/brain-web && ./.clawdbot/scripts/ops-digest.sh
```

---

## “Just do it” templates

### Ship feature

```text
MODE: builder
DO: Implement <feature> end-to-end and deploy.
CONSTRAINTS: keep existing API stable; add tests for changed behavior.
DONE WHEN: merged PR + production healthy + short changelog note.
```

### Fix prod incident

```text
MODE: builder
DO: Triage and fix <incident> in production.
CONSTRAINTS: prioritize rollback safety; no risky refactors.
DONE WHEN: root cause identified, patch deployed, health checks green, incident summary posted.
```

### Learn mode

```text
MODE: teacher
DO: Explain <topic/system> using my current repo context.
CONSTRAINTS: practical only; avoid generic theory.
DONE WHEN: I can make 1 confident decision + have next 3 actions.
```
