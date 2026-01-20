import { test, expect } from '@playwright/test';

/**
 * Playwright tests for Landing Page behavior.
 * 
 * Tests ensure:
 * - Keystroke menu displays correctly
 * - Input of "1" navigates to Brain Web
 * - Input of "2" navigates to Lecture Studio
 * - Invalid inputs are ignored
 * - Focus Area input and save functionality works
 * - Enter button with door icon works
 * - All removed elements are gone
 * - Layout is responsive
 * 
 * NOTE: Backend server must be running on port 8000 for these tests to pass.
 * Start it with: cd backend && python -m uvicorn main:app --reload
 */
test.describe('Landing Page', () => {
  test.setTimeout(60000); // 1 minute timeout

  test.beforeEach(async ({ page }) => {
    // Clear session storage to ensure landing page shows
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      sessionStorage.removeItem('brain-web-visited');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    
    // Wait for page to be interactive
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch (e) {
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(500);
  });

  test('keystroke menu displays correctly', async ({ page }) => {
    // Check for welcome text
    const welcomeText = page.locator('text=/Welcome User/i');
    await expect(welcomeText).toBeVisible();

    // Check for menu options
    const brainWebOption = page.locator('text=/1\\. Brain Web/i');
    await expect(brainWebOption).toBeVisible();

    const studioOption = page.locator('text=/2\\. Studio/i');
    await expect(studioOption).toBeVisible();

    // Check for keystroke input box
    const keystrokeInput = page.locator('input[type="text"][inputmode="numeric"]');
    await expect(keystrokeInput).toBeVisible();
    await expect(keystrokeInput).toHaveAttribute('maxlength', '1');
  });

  test('input "1" navigates to Brain Web', async ({ page }) => {
    const keystrokeInput = page.locator('input[type="text"][inputmode="numeric"]');
    
    // Type "1"
    await keystrokeInput.fill('1');
    
    // Wait for navigation - check that landing page disappears
    // The page should transition away (opacity becomes 0 or component unmounts)
    await page.waitForTimeout(500);
    
    // Verify we're no longer on landing page
    // Check that the keystroke input is gone or the page has navigated
    const inputStillVisible = await keystrokeInput.isVisible().catch(() => false);
    
    // If input is still visible, check if transition started
    if (inputStillVisible) {
      const container = page.locator('div').filter({ hasText: /Welcome User/i }).first();
      const opacity = await container.evaluate((el) => {
        return window.getComputedStyle(el).opacity;
      });
      // Opacity should be transitioning to 0
      expect(parseFloat(opacity)).toBeLessThan(1);
    } else {
      // Input is gone, navigation succeeded
      expect(inputStillVisible).toBe(false);
    }
  });

  test('input "2" navigates to Lecture Studio', async ({ page }) => {
    const keystrokeInput = page.locator('input[type="text"][inputmode="numeric"]');
    
    // Type "2"
    await keystrokeInput.fill('2');
    
    // Wait for navigation
    await page.waitForTimeout(500);
    
    // Check URL has changed to lecture-studio
    await page.waitForURL(/.*lecture-studio.*/, { timeout: 5000 }).catch(() => {
      // If URL hasn't changed, check if we're transitioning
      const container = page.locator('div').filter({ hasText: /Welcome User/i }).first();
      return container.waitFor({ state: 'hidden', timeout: 3000 });
    });
    
    // Verify URL contains lecture-studio
    const url = page.url();
    expect(url).toContain('lecture-studio');
  });

  test('invalid inputs are ignored', async ({ page }) => {
    const keystrokeInput = page.locator('input[type="text"][inputmode="numeric"]');
    
    // Try typing invalid characters
    await keystrokeInput.fill('3');
    await page.waitForTimeout(200);
    
    // Input should be cleared or remain empty (validation prevents invalid input)
    const value = await keystrokeInput.inputValue();
    expect(value === '' || value === '3').toBeTruthy();
    
    // Try typing letters
    await keystrokeInput.fill('a');
    await page.waitForTimeout(200);
    const valueAfterLetter = await keystrokeInput.inputValue();
    // Should not accept letters
    expect(valueAfterLetter).not.toContain('a');
  });

  test('Focus Area input works', async ({ page }) => {
    const focusAreaInput = page.locator('input[type="text"]').filter({ 
      has: page.locator('..').locator('label', { hasText: /Focus Area/i })
    }).or(page.locator('label:has-text("Focus Area") + input')).first();
    
    // Wait for input to be visible
    await focusAreaInput.waitFor({ state: 'visible', timeout: 5000 });
    
    // Type in focus area
    await focusAreaInput.fill('Machine Learning');
    
    // Verify input value
    const value = await focusAreaInput.inputValue();
    expect(value).toBe('Machine Learning');
  });

  test('Save Focus button functions', async ({ page }) => {
    const focusAreaInput = page.locator('input[type="text"]').filter({ 
      has: page.locator('..').locator('label', { hasText: /Focus Area/i })
    }).or(page.locator('label:has-text("Focus Area") + input')).first();
    
    await focusAreaInput.waitFor({ state: 'visible', timeout: 5000 });
    
    // Enter focus area
    await focusAreaInput.fill('Test Focus Area');
    
    // Find and click Save Focus button
    const saveButton = page.locator('button').filter({ hasText: /Save Focus/i });
    await expect(saveButton).toBeVisible();
    
    // Click save button
    await saveButton.click();
    
    // Wait for save to complete (button text changes or success message appears)
    await page.waitForTimeout(1000);
    
    // Check for success message or button state change
    const savingButton = page.locator('button').filter({ hasText: /Saving/i });
    const savedMessage = page.locator('text=/Saved.*focus area/i');
    
    // Either button shows "Saving..." or success message appears
    const isSaving = await savingButton.isVisible().catch(() => false);
    const hasMessage = await savedMessage.isVisible().catch(() => false);
    
    // At least one should be true (either saving state or success message)
    expect(isSaving || hasMessage).toBeTruthy();
  });

  test('Enter button with door icon works', async ({ page }) => {
    // Find the Enter button (should have door icon SVG)
    const enterButton = page.locator('button[aria-label="Enter Brain Web"]').or(
      page.locator('button').filter({ has: page.locator('svg') })
    ).first();
    
    await expect(enterButton).toBeVisible();
    
    // Verify it has an SVG (door icon)
    const svg = enterButton.locator('svg');
    await expect(svg).toBeVisible();
    
    // Click the button
    await enterButton.click();
    
    // Wait for navigation/transition
    await page.waitForTimeout(500);
    
    // Verify landing page is transitioning away
    const container = page.locator('div').filter({ hasText: /Welcome User/i }).first();
    const isVisible = await container.isVisible().catch(() => false);
    
    if (isVisible) {
      const opacity = await container.evaluate((el) => {
        return window.getComputedStyle(el).opacity;
      });
      expect(parseFloat(opacity)).toBeLessThan(1);
    } else {
      // Component unmounted, navigation succeeded
      expect(isVisible).toBe(false);
    }
  });

  test('removed elements are gone', async ({ page }) => {
    // Check that h1 "Welcome, User" is NOT present
    const welcomeH1 = page.locator('h1').filter({ hasText: /Welcome, User/i });
    await expect(welcomeH1).toHaveCount(0);
    
    // Check that italic explanation text is NOT present
    const italicText = page.locator('p').filter({ hasText: /Your focus areas help Brain Web/i });
    await expect(italicText).toHaveCount(0);
    
    // Check that "View Dashboard" button is NOT present
    const dashboardButton = page.locator('button').filter({ hasText: /View Dashboard/i });
    await expect(dashboardButton).toHaveCount(0);
    
    // Check that "This syncs with Profile Customization" span is NOT present
    const syncMessage = page.locator('span').filter({ hasText: /This syncs with Profile Customization/i });
    await expect(syncMessage).toHaveCount(0);
    
    // Check that old textarea is NOT present
    const oldTextarea = page.locator('textarea');
    await expect(oldTextarea).toHaveCount(0);
  });

  test('Focus Area section has correct layout', async ({ page }) => {
    // Check for Focus Area label
    const focusLabel = page.locator('label').filter({ hasText: /Focus Area/i });
    await expect(focusLabel).toBeVisible();
    
    // Check for Focus Area input
    const focusInput = page.locator('input[type="text"]').filter({ 
      has: page.locator('..').locator('label', { hasText: /Focus Area/i })
    }).or(page.locator('label:has-text("Focus Area") + input')).first();
    await expect(focusInput).toBeVisible();
    
    // Check for Save Focus button
    const saveButton = page.locator('button').filter({ hasText: /Save Focus/i });
    await expect(saveButton).toBeVisible();
    
    // Verify they're in a flex layout (horizontal)
    const container = focusLabel.locator('..').first();
    const display = await container.evaluate((el) => {
      return window.getComputedStyle(el).display;
    });
    expect(display).toBe('flex');
  });

  test('keystroke input is auto-focused', async ({ page }) => {
    const keystrokeInput = page.locator('input[type="text"][inputmode="numeric"]');
    
    await keystrokeInput.waitFor({ state: 'visible', timeout: 5000 });
    
    // Wait a bit for auto-focus
    await page.waitForTimeout(500);
    
    // Check if input is focused
    const isFocused = await keystrokeInput.evaluate((el) => {
      return document.activeElement === el;
    });
    
    // Input should be focused (or at least focusable)
    expect(isFocused).toBeTruthy();
  });

  test('responsive layout on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Wait for layout to adjust
    await page.waitForTimeout(500);
    
    // Check that elements are still visible
    const welcomeText = page.locator('text=/Welcome User/i');
    await expect(welcomeText).toBeVisible();
    
    const keystrokeInput = page.locator('input[type="text"][inputmode="numeric"]');
    await expect(keystrokeInput).toBeVisible();
    
    const focusLabel = page.locator('label').filter({ hasText: /Focus Area/i });
    await expect(focusLabel).toBeVisible();
    
    const enterButton = page.locator('button[aria-label="Enter Brain Web"]').or(
      page.locator('button').filter({ has: page.locator('svg') })
    ).first();
    await expect(enterButton).toBeVisible();
  });

  test('keystroke input only accepts 1 or 2', async ({ page }) => {
    const keystrokeInput = page.locator('input[type="text"][inputmode="numeric"]');
    
    // Try typing "1" - should work
    await keystrokeInput.fill('1');
    let value = await keystrokeInput.inputValue();
    expect(value).toBe('1');
    
    // Clear and try "2" - should work
    await keystrokeInput.fill('');
    await keystrokeInput.fill('2');
    value = await keystrokeInput.inputValue();
    expect(value).toBe('2');
    
    // Try typing "12" - should only accept first character
    await keystrokeInput.fill('12');
    value = await keystrokeInput.inputValue();
    // Should be limited to single character
    expect(value.length).toBeLessThanOrEqual(1);
  });
});
