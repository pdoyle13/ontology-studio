import { test, expect } from '@playwright/test';
import { connect, openTab, runTag, sparqlCount } from './helpers';

const API = 'http://localhost:7881';
const RR = 'http://www.w3.org/ns/r2rml#';
const G = 'https://studio.local/graphs/mappings';

test.describe('provenance panel', () => {
    test('virtual instances show source -> table -> mapping, opening the editor', async ({ page }) => {
        await connect(page);
        await openTab(page, 'Assets');
        await page.locator('.asset-type .class-row', { hasText: 'Physical objects' }).click({ timeout: 10_000 });
        await page
            .locator('.asset-type', { hasText: 'Physical objects' })
            .locator('.instance-list li', { hasText: 'orders' })
            .first()
            .locator('button[title*="Browse live data"]')
            .click({ timeout: 10_000 });
        await page.locator('.data-grid tbody tr').first().click({ timeout: 15_000 });
        const prov = page.locator('.prov-block');
        await expect(prov).toBeVisible({ timeout: 15_000 });
        await expect(prov).toContainText(/sales_db|orders/);
        await prov.locator('button[title*="mapping editor"]').click({ timeout: 10_000 });
        await expect(page.locator('.mapping-editor')).toBeVisible({ timeout: 8_000 });
        await page.click('.mapping-editor button:has-text("Close")');
    });
});

test.describe('visual R2RML mapping editor', () => {
    test('open, edit predicate, change datatype, add and remove a column mapping', async ({ page, request }) => {
        test.setTimeout(120_000);
        const tag = runTag();
        // scratch TriplesMap fixture — never touches the real source mappings
        const tm = `https://studio.local/mappings/zz-scratch-${tag}`;
        const seed = await request.post(`${API}/db/update`, {
            headers: { 'Content-Type': 'application/sparql-update', 'X-Studio-User': 'pat' },
            data: `INSERT DATA { GRAPH <${G}> {
        <${tm}> a <${RR}TriplesMap> ; <${RR}logicalTable> <${tm}-t> ; <${RR}subjectMap> <${tm}-s> ;
                <${RR}predicateObjectMap> <${tm}-pom-name> .
        <${tm}-t> <${RR}tableName> "zz_scratch_${tag}" .
        <${tm}-s> <${RR}template> "https://x/zz/{id}" ; <${RR}class> <https://x/zz#Scratch${tag}> .
        <${tm}-pom-name> <${RR}predicate> <https://x/zz#name> ; <${RR}objectMap> <${tm}-om-name> .
        <${tm}-om-name> <${RR}column> "name" .
      } }`,
        });
        expect([200, 204]).toContain(seed.status());
        // purge residue from previously failed runs
        await request.post(`${API}/db/update`, {
            headers: { 'Content-Type': 'application/sparql-update', 'X-Studio-User': 'pat' },
            data: `DELETE { GRAPH <${G}> { ?s ?p ?o } } WHERE { GRAPH <${G}> { ?s ?p ?o . ?s2 <${RR}logicalTable> ?lt . FILTER(STRSTARTS(STR(?s), "https://studio.local/mappings/zz-scratch-") && !STRSTARTS(STR(?s), "${tm}")) } }`,
        });
        try {
            await connect(page);
            await openTab(page, 'Assets');
            await page.locator('.asset-type .class-row', { hasText: 'Mappings' }).click({ timeout: 10_000 });
            const row = page
                .locator('.asset-type', { hasText: 'Mappings' })
                .locator('.instance-list li', { hasText: `zz_scratch_${tag}` });
            await expect(row).toBeVisible({ timeout: 10_000 });
            await row.locator('button[title*="Edit mapping"]').click({ timeout: 10_000 });
            await expect(page.locator('.mapping-editor')).toBeVisible({ timeout: 8_000 });
            await expect(page.locator('.mapping-editor input').first()).toHaveValue('https://x/zz/{id}');

            // rename the predicate
            const predInput = page.locator('.mapping-table tbody tr', { hasText: 'name' }).locator('input');
            await predInput.fill(`https://x/zz#fullName${tag}`, { timeout: 10_000 });
            await predInput.press('Enter');
            await expect(async () => {
                expect(
                    await sparqlCount(
                        page,
                        `SELECT ?p WHERE { GRAPH <${G}> { <${tm}-pom-name> <${RR}predicate> <https://x/zz#fullName${tag}> } }`,
                    ),
                ).toBe(1);
            }).toPass({ timeout: 8_000 });

            // set a datatype on the column
            await page
                .locator('.mapping-table tbody tr', { hasText: 'name' })
                .locator('select')
                .selectOption('integer', { timeout: 10_000 });
            await expect(async () => {
                expect(
                    await sparqlCount(
                        page,
                        `SELECT ?d WHERE { GRAPH <${G}> { <${tm}-om-name> <${RR}datatype> <http://www.w3.org/2001/XMLSchema#integer> } }`,
                    ),
                ).toBe(1);
            }).toPass({ timeout: 8_000 });

            // add a new column mapping
            await page.locator('input[placeholder="column name"]').fill('age');
            await page.locator('input[placeholder="predicate IRI"]').fill(`https://x/zz#age${tag}`);
            await page.click('.mapping-editor button:has-text("Add")');
            await expect(page.locator('.mapping-table tbody tr', { hasText: 'age' })).toBeVisible({ timeout: 8_000 });

            // remove it again
            await page
                .locator('.mapping-table tbody tr', { hasText: 'age' })
                .locator('button[title*="Remove"]')
                .click({ timeout: 10_000 });
            await expect(page.locator('.mapping-table tbody tr', { hasText: 'age' })).toHaveCount(0, {
                timeout: 8_000,
            });
        } finally {
            await request.post(`${API}/db/update`, {
                headers: { 'Content-Type': 'application/sparql-update', 'X-Studio-User': 'pat' },
                data: `DELETE { GRAPH <${G}> { ?s ?p ?o } } WHERE { GRAPH <${G}> { ?s ?p ?o FILTER(STRSTARTS(STR(?s), "${tm}")) } }`,
            });
        }
    });
});
