import { test, expect } from '@playwright/test';
import { connect, openTab, runTag, selectGraph, sparqlCount, sparqlUpdate } from './helpers';

const SKOS = 'http://www.w3.org/2004/02/skos/core#';

test.describe('codelist lifecycle', () => {
    test('codelist field pulls active codes; deprecating a code removes it from pick-lists', async ({ page }) => {
        test.setTimeout(120_000);
        const tag = runTag();
        await connect(page);
        // purge codelist-field residue from earlier failed runs
        await sparqlUpdate(
            page,
            `DELETE { GRAPH ?g { ?s ?p ?o } } WHERE { GRAPH ?g { ?s ?p ?o FILTER(REGEX(STR(?s), "prop/fieldt|vocab/fieldt|#priorityT")) } }`,
        );
        await selectGraph(page, 'music');
        // seed a codelist scheme: High / Medium active, Low already deprecated
        const scheme = `https://example.org/music#priority${tag}`;
        await sparqlUpdate(
            page,
            `INSERT DATA { GRAPH <https://example.org/graphs/music> {
        <${scheme}> a <${SKOS}ConceptScheme> ; <${SKOS}prefLabel> "Priority ${tag}" .
        <${scheme}-hi> <${SKOS}inScheme> <${scheme}> ; <${SKOS}prefLabel> "High" .
        <${scheme}-md> <${SKOS}inScheme> <${scheme}> ; <${SKOS}prefLabel> "Medium" .
        <${scheme}-lo> <${SKOS}inScheme> <${scheme}> ; <${SKOS}prefLabel> "Low" ;
                       <http://www.w3.org/2002/07/owl#deprecated> true .
      } }`,
        );
        await page.reload();
        await page.locator('select').nth(1).selectOption({ label: 'Local Oxigraph (studio)' });
        await selectGraph(page, 'music');
        await openTab(page, 'Taxonomy');

        // create a codelist-backed custom field for concepts
        await page.click('button[title="Configure custom fields for concepts and schemes"]');
        const section = page.locator('.ext-section', { hasText: 'Concept fields' });
        await section.locator('button:has-text("Add custom field")').click();
        await section.locator('input[placeholder*="Steward"]').fill(`Field${tag}`);
        await section.locator('select').first().selectOption({ label: 'Codelist (from a concept scheme)' });
        await section
            .locator('select')
            .nth(1)
            .selectOption({ label: `Priority ${tag} (3)` });
        await section.locator('button:has-text("Add field")').click();
        await expect(section.locator('.ext-row', { hasText: `Field${tag}` })).toBeVisible({ timeout: 8_000 });
        await page.click('.modal-row button:has-text("Close")');

        // the create-concept dialog shows only ACTIVE codes
        await page.locator('.skos-toolbar select').selectOption({ label: `Priority ${tag} (3)` });
        await page.click('.skos-root button[title="Add top concept"]');
        const field = page.locator('.modal .codelist-select').first();
        await expect(field).toBeVisible({ timeout: 8_000 });
        await expect(async () => {
            const opts = await field.locator('option').allTextContents();
            expect(opts).toContain('High');
            expect(opts).toContain('Medium');
            expect(opts).not.toContain('Low');
        }).toPass({ timeout: 10_000 });

        // create a concept carrying the code
        await page.locator('.modal input').first().fill(`Urgent thing ${tag}`);
        await field.selectOption('High');
        await page.locator('.modal button:has-text("Create")').click();
        await expect(page.locator('.modal .codelist-select')).toHaveCount(0, { timeout: 8_000 });
        await expect(async () => {
            const n = await sparqlCount(
                page,
                `SELECT ?s WHERE { ?s <https://studio.local/vocab/field${tag.toLowerCase()}> "High" }`,
            );
            expect(n).toBe(1);
        }).toPass({ timeout: 10_000 });

        // deprecate Medium from the tree; the pick-list shrinks accordingly
        const medRow = page.locator('.skos-row', { hasText: 'Medium' }).first();
        await medRow.hover();
        await medRow.locator('button[title*="Deprecate"]').click({ timeout: 10_000 });
        await expect(page.locator('.code-deprecated').first()).toBeVisible({ timeout: 8_000 });
        await page.click('.skos-root button[title="Add top concept"]');
        await expect(async () => {
            const opts = await page.locator('.modal .codelist-select').first().locator('option').allTextContents();
            expect(opts).not.toContain('Medium');
            expect(opts).toContain('High');
        }).toPass({ timeout: 10_000 });
        await page.locator('.modal button:has-text("Cancel")').click();

        // cleanup: field + scheme fixtures
        await page.click('button[title="Configure custom fields for concepts and schemes"]');
        const row = page.locator('.ext-row', { hasText: `Field${tag}` });
        await row.locator('button[title="Remove field"]').click();
        const confirm = page.locator('.modal').filter({ hasText: 'Remove custom field' });
        await confirm.locator('button:has-text("Delete")').click();
        await expect(row).toHaveCount(0, { timeout: 8_000 });
        await sparqlUpdate(
            page,
            `DELETE { GRAPH <https://example.org/graphs/music> { ?s ?p ?o } } WHERE { GRAPH <https://example.org/graphs/music> { ?s ?p ?o FILTER(STRSTARTS(STR(?s), "${scheme}") || CONTAINS(STR(?s), "urgent-thing-${tag.toLowerCase()}")) } }`,
        );
    });
});
