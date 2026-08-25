import { test, expect } from '@playwright/test';
import { connect, selectGraph } from './helpers';

test.describe('settings', () => {
  test('system-namespace filter is user-configurable and persists', async ({ page }) => {
    await connect(page);
    await selectGraph(page, 'music');
    await expect(page.locator('.class-name', { hasText: 'Artist' }).first()).toBeVisible({ timeout: 15_000 });

    // hide the music namespace via settings
    await page.click('button[title="Settings"]');
    await expect(page.locator('.modal-title', { hasText: 'Settings' })).toBeVisible();
    const ta = page.locator('.modal textarea');
    const current = await ta.inputValue();
    await ta.fill(`${current}\nhttps://example.org/music#`);
    await page.click('.modal button:has-text("Save")');
    await expect(page.locator('.modal-title', { hasText: 'Settings' })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('.class-name', { hasText: 'Artist' })).toHaveCount(0, { timeout: 10_000 });

    // the setting persists across reload
    await page.reload();
    await page.locator('select').nth(1).selectOption({ label: 'Local Oxigraph (studio)' });
    await selectGraph(page, 'music');
    await expect(page.locator('.class-name', { hasText: 'Artist' })).toHaveCount(0, { timeout: 15_000 });

    // reset to defaults brings it back
    await page.click('button[title="Settings"]');
    await page.click('.modal button:has-text("Reset to defaults")');
    await page.click('.modal button:has-text("Save")');
    await expect(page.locator('.class-name', { hasText: 'Artist' }).first()).toBeVisible({ timeout: 15_000 });
  });
});
