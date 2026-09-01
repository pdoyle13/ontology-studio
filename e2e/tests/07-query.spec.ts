import { test, expect } from '@playwright/test';
import { connect, runTag } from './helpers';

test.describe('query drawer', () => {
    test.beforeEach(async ({ page }) => {
        await connect(page);
        await page.click('.drawer-head');
        await expect(page.locator('.sparql-input')).toBeVisible();
    });

    test('SPARQL SELECT renders a result table with clickable IRIs', async ({ page }) => {
        await page.fill(
            '.sparql-input',
            'SELECT ?s ?p ?o WHERE { GRAPH <https://example.org/graphs/music> { ?s ?p ?o } } LIMIT 5',
        );
        await page.click('button:has-text("Run")');
        await expect(page.locator('.sparql-results .result-table tbody tr').first()).toBeVisible({ timeout: 15_000 });
        expect(await page.locator('.sparql-results tbody tr').count()).toBe(5);
        await expect(page.locator('.sparql-results .term-link').first()).toBeVisible();
    });

    test('ASK returns a boolean', async ({ page }) => {
        await page.fill('.sparql-input', 'ASK { ?s a <https://example.org/music#Artist> }');
        await page.click('button:has-text("Run")');
        await expect(page.locator('.sparql-results .term-literal', { hasText: /^true$/ })).toBeVisible({
            timeout: 15_000,
        });
    });

    test('CONSTRUCT returns turtle and can be shown on canvas', async ({ page }) => {
        await page.fill(
            '.sparql-input',
            'CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <https://example.org/graphs/music> { ?s ?p ?o . ?s a <https://example.org/music#Artist> } } LIMIT 10',
        );
        await page.click('button:has-text("Run")');
        await expect(page.locator('.turtle-out')).toBeVisible({ timeout: 15_000 });
        await page.click('button:has-text("Show on canvas")');
        await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    });

    test('SQL mode runs read-only queries against a chosen source', async ({ page }) => {
        await page.click('.drawer-controls button.tab:has-text("SQL")');
        await page.locator('.drawer-controls select:has(option[value="sales_db"])').selectOption('sales_db');
        await page.fill('.sparql-input', 'SELECT status, COUNT(*) AS n FROM orders GROUP BY status');
        await page.click('button:has-text("Run")');
        await expect(page.locator('.sparql-results .result-table tbody tr').first()).toBeVisible({ timeout: 15_000 });
    });

    test('SQL mode blocks writes', async ({ page }) => {
        await page.click('.drawer-controls button.tab:has-text("SQL")');
        await page.locator('.drawer-controls select:has(option[value="sales_db"])').selectOption('sales_db');
        await page.fill('.sparql-input', 'DELETE FROM orders');
        await page.click('button:has-text("Run")');
        await expect(page.locator('.sparql-results .err-text')).toContainText(/read-only/i, { timeout: 10_000 });
    });

    test('saved queries: save, reload, run, delete', async ({ page }) => {
        const tag = runTag();
        const q = `SELECT ?a WHERE { ?a a <https://example.org/music#Artist> } LIMIT 3`;
        await page.fill('.sparql-input', q);
        page.once('dialog', (d) => d.accept(`SQ ${tag}`));
        await page.click('button:has-text("Save")');
        await expect(async () => {
            const opts = await page.locator('.saved-picker option').allTextContents();
            expect(opts.join()).toContain(`SQ ${tag}`);
        }).toPass({ timeout: 10_000 });

        await page.fill('.sparql-input', '');
        await page.selectOption('.saved-picker', { label: `SQ ${tag} (sparql)` });
        expect(await page.inputValue('.sparql-input')).toBe(q);
        await page.click('button:has-text("Run")');
        await expect(page.locator('.sparql-results tbody tr').first()).toBeVisible({ timeout: 15_000 });

        await page.click('button[title="Delete this saved query"]');
        await expect(async () => {
            const opts = await page.locator('.saved-picker option').allTextContents();
            expect(opts.join()).not.toContain(`SQ ${tag}`);
        }).toPass({ timeout: 10_000 });
    });

    test('ctrl+enter runs the query', async ({ page }) => {
        await page.fill('.sparql-input', 'SELECT ?s WHERE { ?s a <https://example.org/music#Album> } LIMIT 2');
        await page.locator('.sparql-input').press('Control+Enter');
        await expect(page.locator('.sparql-results tbody tr').first()).toBeVisible({ timeout: 15_000 });
    });

    test('parameterized query: {{placeholders}} get a values form and substitute on run', async ({ page }) => {
        const tag = runTag();
        await page.fill('.sparql-input', 'SELECT ?s WHERE { ?s a {{cls}} } LIMIT {{max}}');
        // a form input appears per placeholder
        await expect(page.locator('.query-params .param-input')).toHaveCount(2);
        await page.locator('.query-params .param-input').nth(0).fill('<https://example.org/music#Artist>');
        await page.locator('.query-params .param-input').nth(1).fill('3');
        await page.click('button:has-text("Run (Ctrl+Enter)")');
        await expect(page.locator('.sparql-results tbody tr')).toHaveCount(3, { timeout: 15_000 });

        // defaults persist with the saved query and reload with it
        page.once('dialog', (d) => d.accept(`param demo ${tag}`));
        await page.click('button:has-text("⤓ Save")');
        await page.fill('.sparql-input', 'SELECT ?s WHERE { ?s ?p ?o } LIMIT 1'); // clobber the editor
        await expect(page.locator('.query-params')).toHaveCount(0);
        await page.locator('.saved-picker').selectOption({ label: `param demo ${tag} (sparql)` });
        await expect(page.locator('.sparql-input')).toHaveValue(/\{\{cls\}\}/);
        await expect(page.locator('.query-params .param-input').nth(1)).toHaveValue('3');
        // clean up the saved query
        await page.click('button:has-text("✕")');
    });
});
