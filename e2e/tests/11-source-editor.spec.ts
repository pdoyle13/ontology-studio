import { test, expect } from '@playwright/test';
import { connect, selectGraph, runTag, sparqlCount } from './helpers';

test.describe('raw source editor', () => {
    test.beforeEach(async ({ page }) => {
        await connect(page);
        await selectGraph(page, 'music');
        await page.click('button:has-text("Source")');
        await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 15_000 });
        await expect(async () => {
            const len = await page.evaluate(() => document.querySelector('.cm-content')?.textContent?.length ?? 0);
            expect(len).toBeGreaterThan(100);
        }).toPass({ timeout: 15_000 });
    });

    test('CodeMirror mounts with highlighting, line numbers, and diff status', async ({ page }) => {
        expect(
            await page.evaluate(() => document.querySelectorAll('.cm-line span[class*="ͼ"]').length),
        ).toBeGreaterThan(20);
        await expect(page.locator('.cm-gutters .cm-lineNumbers')).toBeVisible();
        await expect(page.locator('.source-editor .grid-head')).toContainText('no changes');
    });

    test('autocomplete offers graph classes and common vocabulary', async ({ page }) => {
        await page.click('.cm-content');
        await page.keyboard.press('Control+End');
        await page.keyboard.press('Enter');
        await page.keyboard.type('music:X a music:Alb', { delay: 25 });
        await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible({ timeout: 8_000 });
        const opts = await page.locator('.cm-tooltip-autocomplete li').allTextContents();
        expect(opts.join()).toContain(':Album');
        await page.keyboard.press('Escape');
    });

    test('diff-apply inserts and deletes exactly the edited triples, undoably', async ({ page }) => {
        const tag = runTag();
        await page.click('.cm-content');
        await page.keyboard.press('Control+End');
        await page.keyboard.type(`\n<https://example.org/music#S${tag}> a <https://example.org/music#Artist> .\n`, {
            delay: 5,
        });
        await expect(page.locator('.source-editor .grid-head')).toContainText('+1', { timeout: 10_000 });
        await page.click('.source-editor button:has-text("Apply")');
        await expect(page.locator('.source-editor')).toHaveCount(0, { timeout: 15_000 });
        expect(await sparqlCount(page, `SELECT ?p WHERE { <https://example.org/music#S${tag}> ?p ?o }`)).toBe(1);
        // undo restores
        await page.click('button[title="Undo (Ctrl+Z)"]');
        await expect(async () => {
            expect(await sparqlCount(page, `SELECT ?p WHERE { <https://example.org/music#S${tag}> ?p ?o }`)).toBe(0);
        }).toPass({ timeout: 10_000 });
    });

    test('RDF 1.2 quoted-triple syntax switches to replace mode', async ({ page }) => {
        await page.click('.cm-content');
        await page.keyboard.press('Control+End');
        await page.keyboard.type('\n<< <https://x/a> <https://x/b> <https://x/c> >> <https://x/certainty> "0.9" .\n', {
            delay: 5,
        });
        await expect(page.locator('.source-editor .grid-head')).toContainText('full graph replace', {
            timeout: 10_000,
        });
        await page.click('.source-editor button:has-text("Close")');
    });

    test('parse errors block apply with a message', async ({ page }) => {
        await page.click('.cm-content');
        await page.keyboard.press('Control+End');
        await page.keyboard.type('\nthis is not turtle @@\n', { delay: 5 });
        await expect(page.locator('.source-editor .grid-head')).toContainText('parse error', { timeout: 10_000 });
        await expect(page.locator('.source-editor button:has-text("Apply")')).toBeDisabled();
        await page.click('.source-editor button:has-text("Close")');
    });
});
