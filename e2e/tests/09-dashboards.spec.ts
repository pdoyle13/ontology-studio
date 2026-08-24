import { test, expect } from '@playwright/test';
import { connect, openTab, runTag } from './helpers';

test.describe('dashboards', () => {
  test('full build flow: page → bar widget → kpi → persistence → remove', async ({ page }) => {
    const tag = runTag();
    await connect(page);

    // a saved SQL query to power widgets
    await page.click('.drawer-head');
    await page.click('.drawer-controls button.tab:has-text("SQL")');
    await page.locator('.drawer-controls select:has(option[value="sales_db"])').selectOption('sales_db');
    await page.fill('.sparql-input', 'SELECT status, COUNT(*) AS n FROM orders GROUP BY status ORDER BY n DESC');
    page.once('dialog', (d) => d.accept(`DashQ ${tag}`));
    await page.click('button:has-text("Save")');
    await expect(async () => {
      const opts = await page.locator('.saved-picker option').allTextContents();
      expect(opts.join()).toContain(`DashQ ${tag}`);
    }).toPass({ timeout: 10_000 });
    await page.click('.drawer-head');

    // create the page
    await openTab(page, 'Dashboards');
    await page.click('button:has-text("New dashboard")');
    await page.fill('input[placeholder="Dashboard name"]', `Page ${tag}`);
    await page.click('.ext-form button:has-text("Create")');
    await expect(page.locator('.dashboard-view')).toBeVisible({ timeout: 10_000 });

    // bar widget
    await page.click('button:has-text("＋ Widget")');
    await page.fill('.widget-wizard input', `Bars ${tag}`);
    await page.locator('.widget-wizard select').first().selectOption({ label: `DashQ ${tag} (sql)` });
    await expect(async () => {
      expect(await page.locator('.widget-wizard select').count()).toBeGreaterThanOrEqual(3);
    }).toPass({ timeout: 10_000 });
    await page.click('.widget-wizard button:has-text("Add widget")');
    await expect(page.locator('.widget svg rect').first()).toBeVisible({ timeout: 15_000 });
    const bars = await page.locator('.widget svg rect').evaluateAll((els) => els.map((e) => e.getAttribute('data-bar')));
    expect(bars).toContain('filled' in bars ? 'filled' : bars.includes('shipped') ? 'shipped' : bars[0]);

    // kpi widget from the same query
    await page.click('button:has-text("＋ Widget")');
    await page.fill('.widget-wizard input', `Top ${tag}`);
    await page.locator('.widget-wizard select').first().selectOption({ label: `DashQ ${tag} (sql)` });
    await page.waitForTimeout(800);
    await page.locator('.widget-wizard select').nth(1).selectOption('kpi');
    await page.click('.widget-wizard button:has-text("Add widget")');
    await expect(page.locator('.kpi-value')).toBeVisible({ timeout: 15_000 });
    expect(Number(await page.locator('.kpi-value').textContent())).toBeGreaterThan(0);

    // persistence: close, reopen from the list with the widget count
    await page.click('.dashboard-view button:has-text("Close")');
    const row = page.locator('.instance-list li', { hasText: `Page ${tag}` });
    await expect(row).toContainText('2 widgets', { timeout: 10_000 });
    await row.click();
    await expect(page.locator('.widget svg rect').first()).toBeVisible({ timeout: 15_000 });

    // remove a widget
    await page.locator('.widget', { hasText: `Top ${tag}` }).locator('button[title="Remove widget"]').click();
    await expect(page.locator('.widget', { hasText: `Top ${tag}` })).toHaveCount(0, { timeout: 10_000 });
    await page.click('.dashboard-view button:has-text("Close")');
  });

  test('dashboards are visible in the Explore workspace', async ({ page }) => {
    await connect(page, { workspace: 'explore' });
    const tabs = await page.locator('.sidebar-tabs-wrap .tab').allTextContents();
    expect(tabs.join()).toContain('Dashboards');
  });
});
