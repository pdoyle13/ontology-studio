import { test, expect } from '@playwright/test';
import { connect } from './helpers';

test.describe('data grid', () => {
    test.beforeEach(async ({ page }) => {
        await connect(page);
        await page
            .locator('.class-row', { hasText: 'Orders' })
            .first()
            .locator('button[title="Browse live data (grid)"]')
            .click();
        await expect(page.locator('.data-grid .result-table tbody tr').first()).toBeVisible({ timeout: 15_000 });
    });

    test('opens with a 50-row live page and the SQL footer', async ({ page }) => {
        expect(await page.locator('.data-grid tbody tr').count()).toBe(50);
        await expect(page.locator('.grid-sql')).toContainText(/SELECT .* FROM "orders"/);
        await expect(page.locator('.data-grid .grid-head')).toContainText('live');
    });

    test('sorting a column issues ORDER BY and re-sorts', async ({ page }) => {
        await page.locator('.data-grid th.sortable', { hasText: 'Status' }).first().click();
        await expect(page.locator('.grid-sql')).toContainText('ORDER BY "status" ASC', { timeout: 10_000 });
        await page.locator('.data-grid th.sortable', { hasText: 'Status' }).first().click();
        await expect(page.locator('.grid-sql')).toContainText('ORDER BY "status" DESC', { timeout: 10_000 });
    });

    test('column filter narrows via LIKE', async ({ page }) => {
        const statusIdx = await page
            .locator('.data-grid thead tr')
            .first()
            .locator('th')
            .allTextContents()
            .then((ths) => ths.findIndex((t) => t.includes('Status')));
        const filterInput = page.locator('.data-grid thead tr').nth(1).locator('th').nth(statusIdx).locator('input');
        // type like a human — one keystroke at a time. fill() masked a controlled-
        // input bug where the box reset to empty after every keypress.
        await filterInput.pressSequentially('cancelled', { delay: 20 });
        await expect(filterInput).toHaveValue('cancelled'); // the box echoes what you type
        await filterInput.press('Enter');
        await expect(page.locator('.grid-sql')).toContainText(/LIKE '%cancelled%'/, { timeout: 10_000 });
        await expect(async () => {
            const cells = await page.locator('.data-grid tbody tr').first().allTextContents();
            expect(cells.join()).toContain('cancelled');
        }).toPass({ timeout: 10_000 });
    });

    test('load more appends the next page', async ({ page }) => {
        const before = await page.locator('.data-grid tbody tr').count();
        await page.click('.data-grid button:has-text("Load more")');
        await expect(async () => {
            expect(await page.locator('.data-grid tbody tr').count()).toBeGreaterThan(before);
        }).toPass({ timeout: 10_000 });
    });

    test('row click opens the virtual record in the inspector', async ({ page }) => {
        await page.locator('.data-grid tbody tr').first().click();
        await expect(page.locator('.entity-meta, .shape-form').first()).toBeVisible({ timeout: 10_000 });
    });

    test('grid works on the kalshi trading estate too', async ({ page }) => {
        await page.click('.data-grid button:has-text("Close")');
        const row = page.locator('.class-row', { hasText: 'Auto Bets' }).first();
        if ((await row.count()) === 0) test.skip();
        await row.locator('button[title="Browse live data (grid)"]').click();
        await expect(page.locator('.data-grid .grid-head')).toContainText('kalshi', { timeout: 15_000 });
        await expect(page.locator('.data-grid tbody tr').first()).toBeVisible({ timeout: 15_000 });
    });
});
