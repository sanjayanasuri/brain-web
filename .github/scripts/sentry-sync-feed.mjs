#!/usr/bin/env node
/**
 * Sync unresolved Sentry issues into GitHub agent feed (label agent-fix)
 * with stable dedupe_key + routing metadata.
 *
 * Requires:
 * - SENTRY_AUTH_TOKEN
 * - SENTRY_ORG
 * - SENTRY_PROJECT
 * - GITHUB_TOKEN
 * - GITHUB_REPOSITORY
 */

const SENTRY_AUTH = process.env.SENTRY_AUTH_TOKEN;
const SENTRY_ORG = process.env.SENTRY_ORG;
const SENTRY_PROJECT = process.env.SENTRY_PROJECT;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;

if (!SENTRY_AUTH || !SENTRY_ORG || !SENTRY_PROJECT || !GITHUB_TOKEN || !GITHUB_REPOSITORY) {
  console.log('Missing SENTRY_* or GITHUB_* env vars; skipping sync');
  process.exit(0);
}

const [owner, repo] = GITHUB_REPOSITORY.split('/');
const SENTRY_BASE = 'https://sentry.io/api/0';
const GITHUB_BASE = `https://api.github.com/repos/${owner}/${repo}`;

async function gh(method, path, body) {
  const url = path.startsWith('http') ? path : GITHUB_BASE + path;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`GitHub ${method} ${path}: ${res.status} ${msg}`);
  }
  return res.json();
}

function parseAgentFeed(body = '') {
  const marker = body.match(/<!--\s*agent_feed:start\s*-->\s*```json\s*([\s\S]*?)```\s*<!--\s*agent_feed:end\s*-->/i);
  const fallback = body.match(/```json\s*([\s\S]*?)```/i);
  const raw = marker?.[1] || fallback?.[1];
  if (!raw) return null;
  try {
    return JSON.parse(raw.trim())?.agent_feed ?? null;
  } catch {
    return null;
  }
}

async function getOpenDedupeKeys() {
  const issues = await gh('GET', '/issues?labels=agent-fix&state=open&per_page=100');
  const keys = new Set();
  for (const i of issues) {
    const af = parseAgentFeed(i.body || '');
    if (af?.dedupe_key) keys.add(af.dedupe_key);
  }
  return keys;
}

async function getSentryIssues() {
  const url = `${SENTRY_BASE}/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?query=is:unresolved&statsPeriod=24h`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${SENTRY_AUTH}` } });
  if (!res.ok) {
    console.warn('Sentry API error:', res.status);
    return [];
  }
  return res.json();
}

async function createGitHubIssueForSentry(sentryIssue) {
  const sentryId = String(sentryIssue.id);
  const dedupeKey = `sentry:${sentryId}`;
  const permalink = sentryIssue.permalink || `https://sentry.io/organizations/${SENTRY_ORG}/issues/${sentryId}/`;

  const severity = 'high';
  const priority = 'p1';
  const ownerLane = 'backend';

  const agentFeed = {
    agent_feed: {
      type: 'sentry_error',
      source: 'sentry',
      dedupe_key: dedupeKey,
      status: 'queued',
      severity,
      priority,
      owner_lane: ownerLane,
      payload: {
        sentry_issue_id: sentryId,
        event_id: sentryIssue.lastSeenEventID || sentryId,
        title: sentryIssue.title,
        culprit: sentryIssue.culprit,
        permalink,
        metadata: sentryIssue.metadata,
      },
      created_at: new Date().toISOString(),
    },
  };

  const body = [
    '<!-- agent_feed:start -->',
    '```json',
    JSON.stringify(agentFeed),
    '```',
    '<!-- agent_feed:end -->',
    '',
    `**Sentry:** [${sentryIssue.title || 'Issue'}](${permalink})`,
    '',
    `**Culprit:** ${sentryIssue.culprit || '–'}`,
    '',
    '**Suggested action (agent):**',
    '1. Open the Sentry permalink above and check stack trace + tags (`request_id`, `bw_session_id`).',
    '2. Search Loki/backend logs for that `request_id` to see the full request path.',
    '3. Reproduce locally if needed, fix, then resolve the issue in Sentry.',
    '4. See `.github/AGENT_FEED.md` for claim protocol.',
  ].join('\n');

  const created = await gh('POST', '/issues', {
    title: `[Sentry] ${sentryIssue.title || sentryIssue.shortId || sentryId}`,
    body,
    labels: ['agent-fix', 'sentry', 'automated'],
  });

  console.log('Created issue for Sentry issue', sentryId, '->', created.html_url);
}

async function main() {
  const openKeys = await getOpenDedupeKeys();
  const sentryIssues = await getSentryIssues();
  let created = 0;

  for (const si of sentryIssues) {
    const dedupeKey = `sentry:${String(si.id)}`;
    if (openKeys.has(dedupeKey)) continue;
    await createGitHubIssueForSentry(si);
    created++;
  }

  console.log('Sentry sync done. unresolved:', sentryIssues.length, 'new issues:', created);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
