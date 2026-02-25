# Centralized Agent Feed

All observability signals (Lighthouse, Sentry, Playwright, etc.) are turned into **GitHub issues with label `agent-fix`** and a consistent structured body.

## Label

- **`agent-fix`** – every automated signal creates an issue with this label.

## Canonical body format

Each issue starts with a stable machine section, then human markdown.

````markdown
<!-- agent_feed:start -->
```json
{"agent_feed":{"type":"<type>","source":"<source>","dedupe_key":"<source:key>","status":"queued","severity":"low|medium|high|critical","priority":"p0|p1|p2|p3","owner_lane":"frontend|backend|infra","payload":{...},"created_at":"<ISO8601>"}}
```
<!-- agent_feed:end -->

**Summary:** ...
````

## Types and sources

| type                   | source     | Typical payload fields                                 |
|------------------------|------------|---------------------------------------------------------|
| performance_regression | lighthouse | url, metrics, reasons                                   |
| sentry_error           | sentry     | sentry_issue_id, permalink, title, culprit, metadata    |
| playwright_failure     | playwright | run_url, branch, commit, summary, artifact              |

## Queue semantics (claim protocol)

To avoid multiple agents taking the same issue:

1. Agent attempts claim:
   - Add label: `agent-claimed`
   - Comment: `agent_feed_claim` with `{claimed_by, claimed_at, lease_expires_at}`
2. If already claimed and lease is valid, skip.
3. On completion:
   - comment with resolution summary
   - set status to `done` in JSON block (optional)
   - close issue
4. On failure:
   - comment with error summary
   - set status to `failed`

Recommended lease: 20–30 minutes, renewable.

## Consuming the feed (OpenClaw / agents)

1. Poll open issues with label `agent-fix`.
2. Parse JSON from the `agent_feed:start/end` block.
3. Deduplicate by `dedupe_key`.
4. Claim before starting work.
5. Dispatch by `type` + `owner_lane`.
6. Close/comment when done.

## Producers

- Lighthouse: `.github/scripts/lighthouse-regression.mjs`
- Playwright failure issue: `.github/workflows/playwright-tests.yml`
- Sentry sync: `.github/scripts/sentry-sync-feed.mjs`

## Adding a new source

1. Create issue with label `agent-fix`.
2. Include canonical `agent_feed` JSON block with `dedupe_key`, `severity`, `priority`, `owner_lane`.
3. Document type/payload here.
