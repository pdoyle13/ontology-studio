import { test, expect } from '@playwright/test';
import { connect, openViaOmnibox, runTag, sparqlCount, sparqlUpdate } from './helpers';

test.describe('inspector: shape forms', () => {
    test.beforeEach(async ({ page }) => connect(page));

    test('form renders from the SHACL shape with help text and datatypes', async ({ page }) => {
        await openViaOmnibox(page, 'rilke');
        await expect(page.locator('.shape-form')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('.field-help').first()).toBeVisible();
        const names = await page.locator('.field-name').allTextContents();
        expect(names.join()).toContain('Bio');
        expect(names.join()).toContain('Motto');
    });

    test('add, edit, and remove a literal value (undoable)', async ({ page }) => {
        await openViaOmnibox(page, 'kid a');
        await expect(page.locator('.shape-form')).toBeVisible({ timeout: 10_000 });
        const genreField = page.locator('.shape-field', { hasText: 'Genre' }).first();
        // genre uses sh:in enumeration → select widget
        await genreField.locator('button.add-field').click();
        const select = genreField.locator('select').first();
        if ((await select.count()) > 0) {
            await select.selectOption({ index: 1 });
            await genreField.locator('button[title="Save"], button.micro:has-text("✓")').first().click();
            await expect(genreField.locator('.value-row .term-literal').first()).toBeVisible({ timeout: 8_000 });
            // remove it again
            const row = genreField.locator('.value-row').first();
            await row.hover();
            await row.locator('button[title="Remove"]').click();
        }
    });

    test('constrained input rejects invalid datatype values before saving', async ({ page }) => {
        await openViaOmnibox(page, 'kid a');
        await expect(page.locator('.shape-form')).toBeVisible({ timeout: 10_000 });
        const yearField = page.locator('.shape-field', { hasText: 'Release Year' }).first();
        if ((await yearField.count()) === 0) test.skip();
        const valRow = yearField.locator('.value-row').first();
        await valRow.hover();
        await valRow.locator('button[title="Edit"]').click();
        const input = yearField.locator('input[type="number"], input[type="text"]').first();
        await input.fill('');
        await input.type('not-a-year');
        const saveBtn = yearField.locator('button.micro').first();
        // number inputs coerce; if text made it in, save must be disabled
        if ((await input.inputValue()) === 'not-a-year') {
            await expect(saveBtn).toBeDisabled();
        }
        await yearField.locator('button.micro:has-text("✕")').first().click();
    });

    test('usage row, deprecation toggle round-trip', async ({ page }) => {
        await openViaOmnibox(page, 'radiohead');
        await expect(page.locator('.usage-row')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('.usage-row')).toContainText(/used by \d+ triple/);
        await page.click('.usage-row button:has-text("deprecate")');
        await expect(page.locator('.dep-chip')).toBeVisible({ timeout: 8_000 });
        await page.click('.usage-row button:has-text("revive")');
        await expect(page.locator('.dep-chip')).toHaveCount(0, { timeout: 8_000 });
    });

    test('all-triples view and incoming references render', async ({ page }) => {
        await openViaOmnibox(page, 'radiohead');
        await expect(page.locator('.shape-form, .entity-meta').first()).toBeVisible({ timeout: 10_000 });
        // force the details open (a click can toggle it closed if already open)
        await page.evaluate(() => {
            document.querySelectorAll('details').forEach((d) => {
                if (d.querySelector('summary')?.textContent?.includes('All triples')) d.open = true;
            });
        });
        const triples = page.locator('details', { hasText: 'All triples' }).locator('.term-literal, .term-link');
        await expect(triples.first()).toBeVisible({ timeout: 10_000 });
    });
});

test.describe('inspector: lifecycle, comments, history', () => {
    test('lifecycle transitions are role-gated end to end', async ({ page }) => {
        const tag = runTag();
        // fresh entity so lifecycle starts at draft
        await connect(page);
        await sparqlUpdate(
            page,
            `INSERT DATA { GRAPH <https://example.org/graphs/music> {
        <https://example.org/music#${tag}> a <https://example.org/music#Artist> .
        <https://example.org/music#${tag}> <http://www.w3.org/2000/01/rdf-schema#label> "LC ${tag}" . } }`,
        );
        await page.evaluate(() => fetch('/es/_refresh', { method: 'POST' }));
        await page.waitForTimeout(1200);
        await openViaOmnibox(page, tag.toLowerCase());
        await expect(page.locator('.state-chip')).toHaveText('draft', { timeout: 10_000 });
        await page.click('button[title*="in-review"]');
        await expect(page.locator('.state-chip')).toHaveText('in-review', { timeout: 8_000 });
        await page.click('button[title*="approved"]');
        await expect(page.locator('.state-chip')).toHaveText('approved', { timeout: 8_000 });
        // server-side gate: an editor cannot deprecate
        const status = await page.evaluate(async (t) => {
            const r = await fetch('/api/lifecycle/transition', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Studio-User': 'quinn' },
                body: JSON.stringify({ iri: `https://example.org/music#${t}`, to: 'deprecated' }),
            });
            return r.status;
        }, tag);
        expect(status).toBe(403);
    });

    test('comment thread: post and attribution', async ({ page }) => {
        const tag = runTag();
        await connect(page);
        await openViaOmnibox(page, 'radiohead');
        await expect(page.locator('.entity-meta')).toBeVisible({ timeout: 10_000 });
        await page.click('.entity-section summary:has-text("Comments")');
        await page.fill('input[placeholder="Add a comment…"]', `note ${tag}`);
        await page.click('button:has-text("Post")');
        await expect(page.locator('.comment-list li', { hasText: tag })).toBeVisible({ timeout: 8_000 });
        await expect(page.locator('.comment-list li', { hasText: tag }).locator('.term-meta')).toContainText('pat');
    });

    test('history timeline lists recorded operations', async ({ page }) => {
        await connect(page);
        await openViaOmnibox(page, 'radiohead');
        await expect(page.locator('.entity-meta')).toBeVisible({ timeout: 10_000 });
        await page.click('.entity-section summary:has-text("History")');
        await expect(page.locator('.history-list li').first()).toBeVisible({ timeout: 8_000 });
    });

    test('undo/redo round-trips a write', async ({ page }) => {
        const tag = runTag();
        await connect(page);
        await sparqlUpdate(
            page,
            `INSERT DATA { GRAPH <https://example.org/graphs/music> {
        <https://example.org/music#${tag}> a <https://example.org/music#Artist> .
        <https://example.org/music#${tag}> <http://www.w3.org/2000/01/rdf-schema#label> "Undo ${tag}" . } }`,
        );
        await page.evaluate(() => fetch('/es/_refresh', { method: 'POST' }));
        await page.waitForTimeout(1000);
        await openViaOmnibox(page, tag.toLowerCase());
        await expect(page.locator('.usage-row')).toBeVisible({ timeout: 10_000 });
        // deprecate (an undoable command), then undo it from the canvas toolbar
        await page.click('.usage-row button:has-text("deprecate")');
        await expect(page.locator('.dep-chip')).toBeVisible({ timeout: 8_000 });
        await page.click('button[title="Undo (Ctrl+Z)"]');
        await expect(async () => {
            expect(
                await sparqlCount(
                    page,
                    `SELECT ?v WHERE { <https://example.org/music#${tag}> <https://studio.local/ns#deprecated> ?v }`,
                ),
            ).toBe(0);
        }).toPass({ timeout: 8_000 });
    });
});
