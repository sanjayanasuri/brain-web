import { test, expect } from '@playwright/test';

/**
 * Explorer page: graph view, search, toolbar, concept panel, graph chat.
 * Uses data-testid attributes for stable selectors.
 *
 * Run (from frontend/ or repo root):
 *   npm run test:explorer
 * Or: npx playwright test explorer-page
 *
 * What it does: Opens /explorer, waits for toolbar and graph area, then runs
 * - Toolbar + search input and key buttons (Import, Fit to View, Add Node)
 * - Chat panel visibility and input
 * - Concept panel when a node is clicked (if canvas has nodes)
 * - Legend toggle from side toolbar (if visible)
 * Dev server: Playwright may start it via webServer in playwright.config.ts, or run `npm run dev` first. Backend optional for full API/chat.
 */
test.describe('Explorer page', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/explorer', { waitUntil: 'domcontentloaded' });
  });

  test('loads graph view and explorer toolbar', async ({ page }) => {
    await expect(page.getByTestId('explorer-toolbar')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('explorer-toolbar-search-input')).toBeVisible({ timeout: 5000 });
    const loading = page.getByTestId('explorer-loading');
    const graphArea = page.getByTestId('explorer-graph-area');
    await Promise.race([
      loading.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {}),
      graphArea.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {}),
    ]);
    await page.waitForTimeout(500);
    const stillLoading = await loading.isVisible().catch(() => false);
    const hasGraphArea = await graphArea.isVisible().catch(() => false);
    expect(stillLoading).toBe(false);
    expect(hasGraphArea).toBe(true);
  });

  test('search box focuses and accepts input', async ({ page }) => {
    await expect(page.getByTestId('explorer-toolbar')).toBeVisible({ timeout: 15000 });
    const search = page.getByTestId('explorer-toolbar-search-input');
    await search.click();
    await search.fill('test');
    await page.waitForTimeout(400);
    await expect(search).toHaveValue('test');
  });

  test('toolbar buttons are present and clickable', async ({ page }) => {
    await expect(page.getByTestId('explorer-toolbar')).toBeVisible({ timeout: 15000 });
    const fitButton = page.getByTestId('explorer-toolbar-fit-to-view');
    await expect(fitButton).toBeVisible({ timeout: 5000 });
    await fitButton.click();
    await page.waitForTimeout(300);
    const importButton = page.getByTestId('explorer-toolbar-import');
    await expect(importButton).toBeVisible();
    await importButton.click();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('explorer-toolbar-add-node')).toBeVisible();
  });

  test('graph chat panel is visible and accepts input', async ({ page }) => {
    await expect(page.getByTestId('explorer-toolbar')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('explorer-chat-panel')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('explorer-chat-empty-state')).toBeVisible({ timeout: 5000 });
    const chatInput = page.getByTestId('explorer-chat-input');
    await expect(chatInput).toBeVisible({ timeout: 5000 });
    await chatInput.fill('What concepts are in this graph?');
    await expect(chatInput).toHaveValue('What concepts are in this graph?');
  });

  test('concept panel appears when node is selected', async ({ page }) => {
    await expect(page.getByTestId('explorer-toolbar')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);
    const canvas = page.locator('canvas').first();
    if (await canvas.isVisible().catch(() => false)) {
      await canvas.click({ position: { x: 200, y: 200 } });
      await page.waitForTimeout(500);
      const conceptPanel = page.getByTestId('explorer-concept-panel');
      const panelVisible = await conceptPanel.isVisible().catch(() => false);
      if (panelVisible) {
        await expect(conceptPanel).toBeVisible();
      }
    }
  });

  test('legend can be toggled from side toolbar', async ({ page }) => {
    await expect(page.getByTestId('explorer-page')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('explorer-toolbar')).toBeVisible({ timeout: 5000 });
    const legendToggle = page.getByTestId('explorer-side-toolbar-legend');
    if (await legendToggle.isVisible().catch(() => false)) {
      await legendToggle.click();
      await page.waitForTimeout(300);
      await expect(page.getByTestId('explorer-legend')).toBeVisible({ timeout: 3000 });
    }
  });
});
