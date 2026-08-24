import { test, expect } from '@playwright/test';
import { connect } from './helpers';

test.describe('workspaces & connection', () => {
  test('connects and shows the model workspace', async ({ page }) => {
    await connect(page, { workspace: 'model' });
    await expect(page.locator('.class-list li').first()).toBeVisible();
    await expect(page.locator('.brand')).toHaveText('YAOE');
  });

  test('each workspace filters tabs and lands on its default', async ({ page }) => {
    await connect(page, { workspace: 'model' });
    const tabs = async () => page.locator('.sidebar-tabs-wrap .tab').allTextContents();

    await page.selectOption('.workspace-switch', 'govern');
    await expect(page.locator('.sidebar-tabs-wrap .tab.active')).toContainText('Reviews');
    expect((await tabs()).join()).toContain('Quality');

    await page.selectOption('.workspace-switch', 'integrate');
    await expect(page.locator('.sidebar-tabs-wrap .tab.active')).toContainText('SQL');

    await page.selectOption('.workspace-switch', 'model');
    expect((await tabs()).join()).toContain('Shapes');
    expect((await tabs()).join()).toContain('Rules');
  });

  test('explore is read-only: write affordances hidden', async ({ page }) => {
    await connect(page, { workspace: 'explore' });
    expect(await page.evaluate(() => document.body.classList.contains('ws-readonly'))).toBe(true);
    await page.selectOption('.workspace-switch', 'model');
    expect(await page.evaluate(() => document.body.classList.contains('ws-readonly'))).toBe(false);
  });

  test('workspace choice persists in the URL and wins on load', async ({ page }) => {
    await connect(page, { workspace: 'model' });
    await page.selectOption('.workspace-switch', 'govern');
    expect(page.url()).toContain('workspace=govern');
    await page.goto('/?workspace=integrate');
    await expect(page.locator('.workspace-switch')).toHaveValue('integrate');
  });

  test('presence badge and import/export button render when connected', async ({ page }) => {
    await connect(page);
    await expect(page.locator('.presence')).toBeVisible();
    await expect(page.locator('button:has-text("Import / Export")')).toBeVisible();
  });
});
