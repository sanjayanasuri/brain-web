#!/usr/bin/env node
const { spawn } = require("child_process");

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: "pipe", shell: process.platform === "win32", ...opts });
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (out += d.toString()));
    p.on("close", (code) => resolve({ code, out }));
  });
}

function runBg(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { stdio: "pipe", shell: process.platform === "win32", ...opts });
  let out = "";
  p.stdout.on("data", (d) => (out += d.toString()));
  p.stderr.on("data", (d) => (out += d.toString()));
  return { p, getOut: () => out };
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // node18+ has global fetch
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function short(s, n = 8000) {
  if (s.length <= n) return s;
  return s.slice(0, n) + "\n...[truncated]...";
}

async function main() {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
  const maxIters = Number(process.env.MAX_ITERS || "1"); // set >1 if you later auto-apply patches

  for (let i = 1; i <= maxIters; i++) {
    const report = { iter: i, steps: [] };

    // 1) build (typecheck happens here)
    {
      const r = await run("npm", ["run", "build"]);
      report.steps.push({ step: "build", code: r.code, output: short(r.out) });
      if (r.code !== 0) {
        console.log(JSON.stringify(report, null, 2));
        process.exit(1);
      }
    }

    // 2) unit tests (optional but recommended)
    if (process.env.SKIP_UNIT !== "1") {
      const r = await run("npm", ["test"]);
      report.steps.push({ step: "test", code: r.code, output: short(r.out) });
      if (r.code !== 0) {
        console.log(JSON.stringify(report, null, 2));
        process.exit(1);
      }
    }

    // 3) start server
    const server = runBg("npm", ["run", "start"], {
      env: { ...process.env, PORT: "3000", NODE_ENV: "production" },
    });

    const up = await waitForServer(baseURL, 60000);
    if (!up) {
      report.steps.push({ step: "start", code: 1, output: short(server.getOut()) });
      try { server.p.kill("SIGTERM"); } catch {}
      console.log(JSON.stringify(report, null, 2));
      process.exit(1);
    }

    // 4) e2e smoke (fails on console/page errors due to your smoke test)
    {
      const r = await run("npm", ["run", "test:e2e"], {
        env: { ...process.env, PLAYWRIGHT_BASE_URL: baseURL },
      });
      report.steps.push({ step: "playwright", code: r.code, output: short(r.out) });

      try { server.p.kill("SIGTERM"); } catch {}
      if (r.code !== 0) {
        console.log(JSON.stringify(report, null, 2));
        process.exit(1);
      }
    }

    // if we got here, this iteration is clean
    console.log(JSON.stringify({ ok: true, ...report }, null, 2));
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
