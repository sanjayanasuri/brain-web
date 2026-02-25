#!/usr/bin/env node
/**
 * Runs Lighthouse on PRODUCTION_URL, creates agent-feed issue if regressed.
 * Adds dedupe_key + routing metadata.
 */
import { createRequire } from 'module';
import { URL } from 'url';

const require = createRequire(import.meta.url);
const lighthouse = require('lighthouse');
const puppeteer = require('puppeteer');

const PRODUCTION_URL = process.env.PRODUCTION_URL;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;

if (!PRODUCTION_URL) {
  console.error('PRODUCTION_URL is required');
  process.exit(1);
}

const THRESHOLDS = { performance: 0.7, lcpMs: 2500, cls: 0.1 };

function extractMetrics(report) {
  const lhr = report?.lhr ?? report;
  const categories = lhr?.categories || {};
  const audits = lhr?.audits || {};
  return {
    performance: categories.performance?.score ?? 0,
    lcpMs: audits['largest-contentful-paint']?.numericValue ?? 0,
    cls: audits['cumulative-layout-shift']?.numericValue ?? 0,
  };
}

function checkRegression(m) {
  const issues = [];
  if (m.performance < THRESHOLDS.performance) issues.push(`Performance ${(m.performance * 100).toFixed(0)} < ${THRESHOLDS.performance * 100}`);
  if (m.lcpMs > THRESHOLDS.lcpMs) issues.push(`LCP ${Math.round(m.lcpMs)}ms > ${THRESHOLDS.lcpMs}ms`);
  if (m.cls > THRESHOLDS.cls) issues.push(`CLS ${m.cls.toFixed(2)} > ${THRESHOLDS.cls}`);
  return issues;
}

function parseAgentFeed(body = '') {
  const marker = body.match(/<!--\s*agent_feed:start\s*-->\s*```json\s*([\s\S]*?)```\s*<!--\s*agent_feed:end\s*-->/i);
  const fallback = body.match(/```json\s*([\s\S]*?)```/i);
  const raw = marker?.[1] || fallback?.[1];
  if (!raw) return null;
  try { return JSON.parse(raw.trim())?.agent_feed ?? null; } catch { return null; }
}

async function gh(method, path, body) {
  const [owner, repo] = GITHUB_REPOSITORY.split('/');
  const url = path.startsWith('http') ? path : `https://api.github.com/repos/${owner}/${repo}${path}`;
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
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function existingOpenDedupeKeys() {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) return new Set();
  const issues = await gh('GET', '/issues?labels=agent-fix&state=open&per_page=100');
  const keys = new Set();
  for (const i of issues) {
    const af = parseAgentFeed(i.body || '');
    if (af?.dedupe_key) keys.add(af.dedupe_key);
  }
  return keys;
}

async function createIssue(metrics, reasons) {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    console.log('No GITHUB_TOKEN/GITHUB_REPOSITORY, skipping issue creation');
    return;
  }

  const dedupeKey = `lighthouse:${PRODUCTION_URL}`;
  const openKeys = await existingOpenDedupeKeys();
  if (openKeys.has(dedupeKey)) {
    console.log('Existing open lighthouse issue found, skipping duplicate.');
    return;
  }

  const commitSha = process.env.GITHUB_SHA || process.env.COMMIT_SHA || '';
  const agentFeed = {
    agent_feed: {
      type: 'performance_regression',
      source: 'lighthouse',
      dedupe_key: dedupeKey,
      status: 'queued',
      severity: 'high',
      priority: 'p1',
      owner_lane: 'frontend',
      payload: {
        url: PRODUCTION_URL,
        metrics: { performance: metrics.performance, lcpMs: metrics.lcpMs, cls: metrics.cls },
        reasons,
        ...(commitSha && { commit_sha: commitSha }),
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
    `**URL:** ${PRODUCTION_URL}`,
    ...(commitSha ? ['', `**Commit:** \`${commitSha}\` (run at audit time)`, ''] : []),
    '',
    '**Metrics:**',
    `- Performance: ${(metrics.performance * 100).toFixed(0)}`,
    `- LCP: ${Math.round(metrics.lcpMs)}ms`,
    `- CLS: ${metrics.cls.toFixed(2)}`,
    '',
    '**Regressions:**',
    ...reasons.map(r => `- ${r}`),
  ].join('\n');

  const created = await gh('POST', '/issues', {
    title: '[Performance regression] Speed Insights below threshold',
    body,
    labels: ['agent-fix', 'performance-regression', 'automated'],
  });
  console.log('Created issue:', created.html_url);
}

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  try {
    const port = Number(new URL(browser.wsEndpoint()).port);
    const report = await lighthouse(PRODUCTION_URL, { port, output: 'json', logLevel: 'silent', onlyCategories: ['performance'] });
    const metrics = extractMetrics(report);
    const reasons = checkRegression(metrics);
    if (!reasons.length) return console.log('All metrics within thresholds.');
    await createIssue(metrics, reasons);
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
