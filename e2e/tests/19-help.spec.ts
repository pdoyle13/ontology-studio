import { test, expect } from '@playwright/test';
import { connect } from './helpers';

test.describe('help', () => {
  test('? opens bundled docs; guide first, navigable, API link present', async ({ page }) => {
    await connect(page);
    await page.click('button[title*="Help"]');
    const dlg = page.locator('.help-dialog');
    await expect(dlg).toBeVisible({ timeout: 8_000 });
    // the user guide renders first
    await expect(dlg.locator('.help-md h1')).toContainText('Using Ontology Studio');
    await expect(dlg.locator('.help-md')).toContainText('drag from a node');
    // switch docs
    await dlg.locator('.help-nav-item', { hasText: 'For stewards' }).click();
    await expect(dlg.locator('.help-md')).not.toContainText('Using Ontology Studio');
    // live API reference is linked
    await expect(dlg.locator('a.help-nav-item')).toHaveAttribute('href', '/api/docs');
    await dlg.locator('button:has-text("Close")').click();
    await expect(dlg).toHaveCount(0);
  });
});
