import { test, expect } from '@playwright/test';
import { connect, openTab, runTag, purgeTestResidue } from './helpers';

test.describe('taxonomy editor', () => {
    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        await page.goto('http://localhost:5180');
        await purgeTestResidue(page);
        await page.close();
    });

    test.beforeEach(async ({ page }) => {
        await connect(page);
        await openTab(page, 'Taxonomy');
        await expect(page.locator('.taxonomy-panel')).toBeVisible({ timeout: 8_000 });
    });

    test('scheme create dialog → top concept → narrower concept', async ({ page }) => {
        const tag = runTag();
        await page.click('button:has-text("Scheme")');
        await expect(page.locator('.modal-title:has-text("New concept scheme")')).toBeVisible();
        await page.locator('.modal input').first().fill(`Scheme ${tag}`);
        await page.click('.modal button:has-text("Create")');
        await expect(async () => {
            const opts = await page.locator('.skos-toolbar option').allTextContents();
            expect(opts.join()).toContain(`Scheme ${tag}`);
        }).toPass({ timeout: 10_000 });

        await page.click('.skos-root button[title="Add top concept"]');
        await expect(page.locator('.modal-title:has-text("New top concept")')).toBeVisible();
        await page.locator('.modal input').first().fill(`Top ${tag}`);
        await page.locator('.modal button:has-text("Create")').click();
        await expect(page.locator('.skos-row', { hasText: `Top ${tag}` })).toBeVisible({ timeout: 10_000 });

        const topRow = page.locator('.skos-row', { hasText: `Top ${tag}` }).first();
        await topRow.hover();
        await topRow.locator('button[title="Add narrower concept"]').click();
        await expect(page.locator('.modal-title', { hasText: 'New concept under' })).toBeVisible();
        await page.locator('.modal input').first().fill(`Child ${tag}`);
        await page.locator('.modal button:has-text("Create")').click();
        const child = page.locator('.skos-row', { hasText: `Child ${tag}` }).first();
        await expect(child).toBeVisible({ timeout: 10_000 });
        // nested = indented deeper than the parent
        const childPad = parseInt((await child.evaluate((el) => (el as HTMLElement).style.paddingLeft)) || '0');
        const topPad = parseInt((await topRow.evaluate((el) => (el as HTMLElement).style.paddingLeft)) || '0');
        expect(childPad).toBeGreaterThan(topPad);
    });

    test('create dialog validates: no prefLabel, no create', async ({ page }) => {
        await page.click('.skos-root button[title="Add top concept"]');
        await expect(page.locator('.modal-title')).toBeVisible();
        await expect(page.locator('.modal button:has-text("Create")')).toBeDisabled();
        await page.click('.modal button:has-text("Cancel")');
    });

    test('drag re-parents; drop on root promotes', async ({ page }) => {
        const tag = runTag();
        // own scheme: which scheme is preselected depends on residue ordering
        await page.click('button:has-text("Scheme")');
        await page.locator('.modal input').first().fill(`DragScheme ${tag}`);
        await page.click('.modal button:has-text("Create")');
        await expect(async () => {
            const opts = await page.locator('.skos-toolbar option').allTextContents();
            expect(opts.join()).toContain(`DragScheme ${tag}`);
        }).toPass({ timeout: 10_000 });
        // fresh sibling pair in it
        for (const label of [`A${tag}`, `B${tag}`]) {
            await page.click('.skos-root button[title="Add top concept"]');
            await page.locator('.modal input').first().fill(label);
            await page.locator('.modal button:has-text("Create")').click();
            await expect(page.locator('.skos-row', { hasText: label })).toBeVisible({ timeout: 10_000 });
        }
        const a = page.locator('.skos-row', { hasText: `A${tag}` }).first();
        const b = page.locator('.skos-row', { hasText: `B${tag}` }).first();
        // grab by the label area - the row centre can land on hover-action buttons
        await a.dragTo(b, { sourcePosition: { x: 30, y: 8 }, targetPosition: { x: 30, y: 8 } });
        await expect(async () => {
            const aPad = parseInt(
                (await page
                    .locator('.skos-row', { hasText: `A${tag}` })
                    .first()
                    .evaluate((el) => (el as HTMLElement).style.paddingLeft)) || '0',
            );
            const bPad = parseInt(
                (await page
                    .locator('.skos-row', { hasText: `B${tag}` })
                    .first()
                    .evaluate((el) => (el as HTMLElement).style.paddingLeft)) || '0',
            );
            expect(aPad).toBeGreaterThan(bPad);
        }).toPass({ timeout: 10_000 });
        // promote back to top
        await page
            .locator('.skos-row', { hasText: `A${tag}` })
            .first()
            .dragTo(page.locator('.skos-root'), { sourcePosition: { x: 30, y: 8 } });
        await expect(async () => {
            const aPad = parseInt(
                (await page
                    .locator('.skos-row', { hasText: `A${tag}` })
                    .first()
                    .evaluate((el) => (el as HTMLElement).style.paddingLeft)) || '0',
            );
            expect(aPad).toBeLessThanOrEqual(8);
        }).toPass({ timeout: 10_000 });
    });

    test('rename updates the prefLabel', async ({ page }) => {
        const tag = runTag();
        await page.click('.skos-root button[title="Add top concept"]');
        await page.locator('.modal input').first().fill(`Old ${tag}`);
        await page.locator('.modal button:has-text("Create")').click();
        const row = page.locator('.skos-row', { hasText: `Old ${tag}` }).first();
        await expect(row).toBeVisible({ timeout: 10_000 });
        page.once('dialog', (d) => d.accept(`New ${tag}`));
        await row.hover();
        await row.locator('button[title="Rename"]').click();
        await expect(page.locator('.skos-row', { hasText: `New ${tag}` })).toBeVisible({ timeout: 10_000 });
    });

    test('extensions: custom field appears in the create dialog and persists values', async ({ page }) => {
        const tag = runTag();
        await page.click('button[title="Configure custom fields for concepts and schemes"]');
        await expect(page.locator('.ext-section', { hasText: 'Concept fields' })).toBeVisible();
        const section = page.locator('.ext-section', { hasText: 'Concept fields' });
        await section.locator('button:has-text("Add custom field")').click();
        await section.locator('input[placeholder*="Steward"]').fill(`Field${tag}`);
        await section.locator('button:has-text("Add field")').click();
        await expect(section.locator('.ext-row', { hasText: `Field${tag}` })).toBeVisible({ timeout: 8_000 });
        await page.click('.modal-row button:has-text("Close")');

        await page.click('.skos-root button[title="Add top concept"]');
        await expect(page.locator('.modal .field-label', { hasText: `Field${tag}` })).toBeVisible({ timeout: 8_000 });
        await page.click('.modal button:has-text("Cancel")');

        // cleanup: remove the field so runs don't accumulate custom fields
        await page.click('button[title="Configure custom fields for concepts and schemes"]');
        const row = page.locator('.ext-row', { hasText: `Field${tag}` });
        await expect(row).toBeVisible({ timeout: 8_000 });
        await row.locator('button[title="Remove field"]').click();
        // the confirm dialog stacks a second .modal on top of the extensions modal
        const confirm = page.locator('.modal').filter({ hasText: 'Remove custom field' });
        await expect(confirm).toBeVisible({ timeout: 5_000 });
        await confirm.locator('button:has-text("Delete")').click();
        await expect(row).toHaveCount(0, { timeout: 8_000 });
    });

    test('CSV import: validated preview then import', async ({ page }) => {
        const tag = runTag();
        await page.click('button[title="Bulk import concepts from a CSV spreadsheet"]');
        await expect(page.locator('.csv-input')).toBeVisible();
        await page.fill(
            '.csv-input',
            `Label,Broader,Definition\nParent${tag},,top level\nKid${tag},Parent${tag},nested\n,,missing label`,
        );
        await expect(page.locator('.modal .term-meta', { hasText: 'rows valid' })).toContainText('2 of 3', {
            timeout: 10_000,
        });
        await page.click(`button:has-text("Import 2 rows")`);
        await expect(page.locator('.skos-row', { hasText: `Kid${tag}` })).toBeVisible({ timeout: 10_000 });
    });
});
