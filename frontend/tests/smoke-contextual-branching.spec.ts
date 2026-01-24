/**
 * Smoke tests for Contextual Branching feature.
 * 
 * Ensures no runtime errors when:
 * - Page loads with branch components
 * - Branch context is initialized
 * - Components render without crashing
 * 
 * Run with: npm run test:e2e
 */
import { test, expect } from '@playwright/test';

test.describe('Contextual Branching - Smoke Tests', () => {
  test('should load home page without errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(`[console.error] ${msg.text()}`);
      }
    });

    page.on('pageerror', (err) => {
      pageErrors.push(`[pageerror] ${err.name}: ${err.message}\n${err.stack ?? ''}`);
    });

    await page.goto('/', { waitUntil: 'networkidle' });

    // Give React time to hydrate and render
    await page.waitForTimeout(1000);

    // Filter out known non-critical errors (Next.js overlay, etc.)
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes('Hydration') &&
        !err.includes('overlay') &&
        !err.includes('webpack') &&
        !err.includes('__NEXT_DATA__')
    );

    expect(pageErrors, 'Uncaught page errors').toEqual([]);
    expect(criticalErrors, 'Critical console errors').toEqual([]);
  });

  test('should render branch components without errors', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Check for branch-related component errors
    const branchErrors = consoleErrors.filter(
      (err) =>
        err.includes('Branch') ||
        err.includes('SelectableText') ||
        err.includes('BranchChip') ||
        err.includes('contextual-branch')
    );

    expect(branchErrors, 'Branch component errors').toEqual([]);
  });

  test('should handle missing API gracefully', async ({ page }) => {
    // Block API calls to simulate offline/missing backend
    await page.route('**/contextual-branches/**', (route) => {
      route.abort('failed');
    });

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Component should handle API failures gracefully
    // Errors should be caught and not crash the page
    const unhandledErrors = consoleErrors.filter(
      (err) => !err.includes('Failed to') && !err.includes('fetch')
    );

    expect(unhandledErrors.length).toBeLessThan(5); // Allow some expected errors
  });
});
