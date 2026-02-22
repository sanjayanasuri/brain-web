#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const CHROME_EXECUTABLE_PATH =
  process.env.CHROME_EXECUTABLE_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHAT_TIMEOUT_MS = Number(process.env.CHAT_TIMEOUT_MS || 15000);
const MAX_INPUTS_PER_ROUTE = Number(process.env.MAX_INPUTS_PER_ROUTE || 4);
const MAX_CLICKS_PER_ROUTE = Number(process.env.MAX_CLICKS_PER_ROUTE || 8);
const ENABLE_CHAT_PROBE =
  String(process.env.ENABLE_CHAT_PROBE || "true").toLowerCase() !== "false";
const HEADLESS =
  String(process.env.HEADLESS || "true").toLowerCase() !== "false";
const PROBE_ROUTES = (process.env.PROBE_ROUTES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const actionResults = [];
const networkEvents = [];
const consoleErrors = [];
const pageErrors = [];

function nowMs() {
  return Date.now();
}

function randomSuffix(length = 6) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function summarizeUrl(input) {
  try {
    const url = new URL(input);
    return `${url.pathname}${url.search || ""}`;
  } catch {
    return input;
  }
}

function pickRandom(list, maxCount) {
  if (list.length <= maxCount) return [...list];
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, maxCount);
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function saveReport(report) {
  const outputDir = path.resolve("test-results");
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `latency-exploratory-${RUN_ID}.json`);
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
  return outputPath;
}

async function safeText(locator) {
  try {
    const aria = await locator.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
  } catch {}
  try {
    const text = await locator.innerText();
    if (text && text.trim()) return text.trim().replace(/\s+/g, " ");
  } catch {}
  try {
    const placeholder = await locator.getAttribute("placeholder");
    if (placeholder && placeholder.trim()) return placeholder.trim();
  } catch {}
  return "untitled-control";
}

async function isInteractive(locator) {
  try {
    const visible = await locator.isVisible();
    const enabled = await locator.isEnabled().catch(() => true);
    return Boolean(visible && enabled);
  } catch {
    return false;
  }
}

async function settle(page, ms = 700) {
  await Promise.race([
    page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {}),
    page.waitForTimeout(ms),
  ]);
}

function shouldSkipDangerousControl(text) {
  return /(delete|remove|unlink|drop|clear all|destroy|logout|log out|sign out|reset)/i.test(
    text
  );
}

async function recordAction(name, fn, metadata = {}) {
  console.log(`[probe] START ${name}`);
  const start = nowMs();
  try {
    const result = await fn();
    const durationMs = nowMs() - start;
    console.log(`[probe] OK    ${name} (${durationMs}ms)`);
    actionResults.push({
      name,
      status: "ok",
      duration_ms: durationMs,
      metadata,
    });
    return result;
  } catch (error) {
    const durationMs = nowMs() - start;
    console.log(`[probe] FAIL  ${name} (${durationMs}ms): ${String(error?.message || error)}`);
    actionResults.push({
      name,
      status: "failed",
      duration_ms: durationMs,
      metadata,
      error: String(error?.message || error),
    });
    return null;
  }
}

async function gotoRoute(page, route) {
  const url = new URL(route, BASE_URL).toString();
  await recordAction(`navigate:${route}`, async () => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page, 900);
  });
}

async function fillRandomInputs(page, route, credentials) {
  const controls = await page
    .locator(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea'
    )
    .all();
  const candidates = [];

  for (const control of controls) {
    if (await isInteractive(control)) {
      candidates.push(control);
    }
  }

  const selected = pickRandom(candidates, Math.max(0, MAX_INPUTS_PER_ROUTE));
  for (const control of selected) {
    const label = await safeText(control);
    const inputType = ((await control.getAttribute("type")) || "").toLowerCase();
    const value =
      inputType === "email"
        ? credentials.email
        : inputType === "password"
          ? credentials.password
          : `latency probe ${route} ${randomSuffix(4)}`;

    await recordAction(`input:${route}:${label.slice(0, 48)}`, async () => {
      await control.fill(value);
      if (Math.random() > 0.6) {
        await control.press("Enter").catch(() => {});
      }
      await settle(page, 500);
    });
  }
}

async function clickRandomButtons(page, route) {
  const buttons = await page.locator("button").all();
  const candidates = [];
  for (const button of buttons) {
    if (await isInteractive(button)) {
      const label = await safeText(button);
      if (!shouldSkipDangerousControl(label)) {
        candidates.push({ button, label });
      }
    }
  }

  const selected = pickRandom(candidates, Math.max(0, MAX_CLICKS_PER_ROUTE));
  for (const { button, label } of selected) {
    await recordAction(`click:${route}:${label.slice(0, 48)}`, async () => {
      await button.click({ timeout: 6000 });
      await settle(page, 800);
    });
  }
}

async function probeChat(page, route) {
  if (!ENABLE_CHAT_PROBE) {
    actionResults.push({
      name: `chat:${route}:skipped`,
      status: "skipped",
      duration_ms: 0,
      metadata: { reason: "chat probe disabled by env" },
    });
    return;
  }

  const chatInput = page.locator(
    [
      "textarea#chat-input",
      "textarea.chat-input",
      'textarea[placeholder*="ask" i]',
      'textarea[placeholder*="message" i]',
      'input[placeholder*="ask" i]',
      'input[placeholder*="message" i]',
    ].join(",")
  );

  const count = await chatInput.count();
  if (!count) {
    actionResults.push({
      name: `chat:${route}:skipped`,
      status: "skipped",
      duration_ms: 0,
      metadata: { reason: "no chat input found" },
    });
    return;
  }

  let activeInput = null;
  for (let i = 0; i < count; i += 1) {
    const candidate = chatInput.nth(i);
    if (await isInteractive(candidate)) {
      activeInput = candidate;
      break;
    }
  }

  if (!activeInput) {
    actionResults.push({
      name: `chat:${route}:skipped`,
      status: "skipped",
      duration_ms: 0,
      metadata: { reason: "chat input present but not interactable" },
    });
    return;
  }

  const query = `Latency probe ${route} ${RUN_ID}`;
  await recordAction(`chat:${route}:send`, async () => {
    const responsePromise = page
      .waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          (/\/api\/brain-web\/chat/.test(response.url()) ||
            /\/brain-web\/chat/.test(response.url()) ||
            /\/ai\/query/.test(response.url())),
        { timeout: CHAT_TIMEOUT_MS }
      )
      .catch(() => null);

    await activeInput.fill(query);
    const sendButton = page.locator(
      [
        "button.send-btn",
        'button[aria-label*="send" i]',
        "button:has-text('Send')",
        "button:has-text('Ask')",
      ].join(",")
    );
    if ((await sendButton.count()) > 0 && (await isInteractive(sendButton.first()))) {
      await sendButton.first().click();
    } else {
      await activeInput.press("Enter");
    }

    const response = await responsePromise;
    if (!response) {
      throw new Error(`No chat network response within ${CHAT_TIMEOUT_MS}ms`);
    }

    await settle(page, 1200);
    const status = response.status();
    if (status >= 400) {
      throw new Error(`Chat request returned HTTP ${status}`);
    }
  });
}

async function run() {
  console.log(`[probe] Run ID ${RUN_ID}`);
  console.log(`[probe] Base URL ${BASE_URL}`);
  console.log(
    `[probe] Settings routes=${PROBE_ROUTES.length ? PROBE_ROUTES.join(",") : "default"} chat=${ENABLE_CHAT_PROBE} maxInputs=${MAX_INPUTS_PER_ROUTE} maxClicks=${MAX_CLICKS_PER_ROUTE}`
  );
  const credentials = {
    email: `latency.${Date.now()}@example.com`,
    password: `Latency!${randomSuffix(8)}`,
    fullName: `Latency Probe ${randomSuffix(4)}`,
  };

  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath: CHROME_EXECUTABLE_PATH,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const requestStarts = new Map();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({
        text: msg.text(),
        url: page.url(),
        ts: new Date().toISOString(),
      });
    }
  });
  page.on("pageerror", (err) => {
    pageErrors.push({
      message: err.message,
      stack: err.stack,
      url: page.url(),
      ts: new Date().toISOString(),
    });
  });
  page.on("request", (request) => {
    requestStarts.set(request, nowMs());
  });
  page.on("response", (response) => {
    const request = response.request();
    const startedAt = requestStarts.get(request);
    requestStarts.delete(request);
    const url = response.url();
    if (url.includes("127.0.0.1:8000") || url.includes("localhost:8000") || /\/api\//.test(url)) {
      networkEvents.push({
        method: request.method(),
        url: summarizeUrl(url),
        status: response.status(),
        duration_ms: startedAt ? nowMs() - startedAt : null,
      });
    }
  });
  page.on("requestfailed", (request) => {
    const startedAt = requestStarts.get(request);
    requestStarts.delete(request);
    const url = request.url();
    if (url.includes("127.0.0.1:8000") || url.includes("localhost:8000") || /\/api\//.test(url)) {
      networkEvents.push({
        method: request.method(),
        url: summarizeUrl(url),
        status: "FAILED",
        duration_ms: startedAt ? nowMs() - startedAt : null,
        error: request.failure()?.errorText || "request failed",
      });
    }
  });

  await gotoRoute(page, "/signup");

  await recordAction("auth:signup:submit", async () => {
    const fullNameInput = page.locator('input[type="text"]').first();
    const emailInput = page.locator('input[type="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    const registerButton = page.locator("button").filter({ hasText: /register/i }).first();

    await fullNameInput.fill(credentials.fullName);
    await emailInput.fill(credentials.email);
    await passwordInput.fill(credentials.password);
    await registerButton.click({ timeout: 10000 });

    await Promise.race([
      page.waitForURL(/\/login/, { timeout: 12000 }).catch(() => {}),
      page.locator("text=/Success\\. Rerouting|Email already registered|failed|error/i").first().waitFor({ timeout: 12000 }).catch(() => {}),
    ]);
    await settle(page, 800);
  });

  await gotoRoute(page, "/login");

  await recordAction("auth:login:submit", async () => {
    const emailInput = page.locator('input[type="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    const loginButton = page.locator("button").filter({ hasText: /login/i }).first();

    await emailInput.fill(credentials.email);
    await passwordInput.fill(credentials.password);
    await loginButton.click({ timeout: 10000 });
    await page.waitForTimeout(900);

    // Confirm auth is truly established; staying on /login should not count as success.
    const sessionResponse = await page.request.get(new URL("/api/auth/session", BASE_URL).toString());
    const sessionText = await sessionResponse.text();
    let hasAccessToken = false;
    try {
      const sessionJson = JSON.parse(sessionText);
      hasAccessToken = Boolean(sessionJson && sessionJson.accessToken);
    } catch {
      hasAccessToken = false;
    }
    if (!hasAccessToken) {
      throw new Error(`Login did not establish session token (status ${sessionResponse.status()})`);
    }

    await page.waitForURL(/\/home/, { timeout: 20000 }).catch(() => {});
    await settle(page, 1000);
  });

  const defaultRoutes = [
    "/home",
    "/dashboard",
    "/explorer",
    "/discover",
    "/lecture-studio",
    "/reader",
  ];
  const routesToProbe = PROBE_ROUTES.length ? PROBE_ROUTES : defaultRoutes;

  for (const route of routesToProbe) {
    console.log(`[probe] ---- Route ${route} ----`);
    await gotoRoute(page, route);
    await fillRandomInputs(page, route, credentials);
    await clickRandomButtons(page, route);
    await probeChat(page, route);
  }

  const successfulActions = actionResults.filter((a) => a.status === "ok");
  const failedActions = actionResults.filter((a) => a.status === "failed");
  const skippedActions = actionResults.filter((a) => a.status === "skipped");

  const actionDurations = successfulActions.map((a) => a.duration_ms);
  const apiLatencyValues = networkEvents
    .map((n) => n.duration_ms)
    .filter((v) => typeof v === "number");

  const networkByUrl = {};
  for (const item of networkEvents) {
    const key = `${item.method} ${item.url}`;
    if (!networkByUrl[key]) {
      networkByUrl[key] = [];
    }
    networkByUrl[key].push(item);
  }

  const networkSummary = Object.entries(networkByUrl)
    .map(([key, values]) => {
      const durations = values
        .map((v) => v.duration_ms)
        .filter((v) => typeof v === "number");
      const failures = values.filter((v) => v.status === "FAILED" || Number(v.status) >= 400).length;
      return {
        endpoint: key,
        count: values.length,
        failures,
        avg_ms: durations.length
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : null,
        p95_ms: durations.length ? Math.round(percentile(durations, 95)) : null,
      };
    })
    .sort((a, b) => (b.p95_ms || 0) - (a.p95_ms || 0));

  const report = {
    run_id: RUN_ID,
    base_url: BASE_URL,
    credentials: {
      email: credentials.email,
      full_name: credentials.fullName,
    },
    summary: {
      total_actions: actionResults.length,
      successful_actions: successfulActions.length,
      failed_actions: failedActions.length,
      skipped_actions: skippedActions.length,
      action_latency_avg_ms: actionDurations.length
        ? Math.round(actionDurations.reduce((a, b) => a + b, 0) / actionDurations.length)
        : null,
      action_latency_p95_ms: actionDurations.length
        ? Math.round(percentile(actionDurations, 95))
        : null,
      api_latency_avg_ms: apiLatencyValues.length
        ? Math.round(apiLatencyValues.reduce((a, b) => a + b, 0) / apiLatencyValues.length)
        : null,
      api_latency_p95_ms: apiLatencyValues.length ? Math.round(percentile(apiLatencyValues, 95)) : null,
      console_errors: consoleErrors.length,
      page_errors: pageErrors.length,
    },
    top_slowest_actions: [...successfulActions]
      .sort((a, b) => b.duration_ms - a.duration_ms)
      .slice(0, 20),
    failed_actions: failedActions,
    network_summary: networkSummary,
    raw: {
      action_results: actionResults,
      network_events: networkEvents,
      console_errors: consoleErrors,
      page_errors: pageErrors,
    },
  };

  const outputPath = await saveReport(report);

  console.log("=== Exploratory Latency Probe Completed ===");
  console.log(`Report file: ${outputPath}`);
  console.log(
    JSON.stringify(
      {
        summary: report.summary,
        slowest_actions: report.top_slowest_actions.slice(0, 10).map((a) => ({
          name: a.name,
          duration_ms: a.duration_ms,
        })),
        failed_action_names: failedActions.map((a) => a.name),
        worst_endpoints: networkSummary.slice(0, 10),
      },
      null,
      2
    )
  );

  await Promise.race([
    context.close().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  await Promise.race([
    browser.close().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
}

run().catch((error) => {
  console.error("Latency exploratory probe failed:", error);
  process.exit(1);
});
