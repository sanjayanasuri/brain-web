import { test, expect } from "@playwright/test";

const URLS = ["/", "/dashboard"]; // <-- edit to key routes that render important UI
// Note: Contextual branching components are tested in contextual-branching.spec.ts

test.describe("smoke: no console/page errors", () => {
  for (const path of URLS) {
    test(`no runtime errors on ${path}`, async ({ page, baseURL }) => {
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];

      page.on("console", (msg) => {
        // Catch console.error and (optionally) warnings
        if (msg.type() === "error") {
          consoleErrors.push(`[console.error] ${msg.text()}`);
        }
      });

      page.on("pageerror", (err) => {
        pageErrors.push(`[pageerror] ${err.name}: ${err.message}\n${err.stack ?? ""}`);
      });

      const url = new URL(path, baseURL ?? "http://localhost:3000").toString();
      await page.goto(url, { waitUntil: "networkidle" });

      // give React time to throw after hydration
      await page.waitForTimeout(500);

      // Filter out known non-critical errors
      const criticalErrors = consoleErrors.filter(
        (err) =>
          !err.includes('Hydration') &&
          !err.includes('overlay') &&
          !err.includes('webpack') &&
          !err.includes('__NEXT_DATA__') &&
          !err.includes('favicon') &&
          !err.includes('Failed to load resource') // Network errors are handled separately
      );

      expect(pageErrors, `Uncaught page errors on ${path}`).toEqual([]);
      expect(criticalErrors, `Critical console errors on ${path}`).toEqual([]);
    });
  }
});
