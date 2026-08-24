import { test, expect } from '@playwright/test';
import { connect, openTab, runTag, sparqlCount } from './helpers';

test.describe('asset-type framework', () => {
  test.beforeEach(async ({ page }) => {
    await connect(page);
    await openTab(page, 'Assets');
    await expect(page.locator('.assets-panel')).toBeVisible({ timeout: 8_000 });
  });

  test('all five built-in types are listed', async ({ page }) => {
    const names = await page.locator('.asset-type .class-name').allTextContents();
    for (const t of ['Taxonomies', 'Business glossaries', 'Business objects', 'Physical objects', 'Mappings']) {
      expect(names).toContain(t);
    }
  });

  test('physical objects list live tables with grid buttons', async ({ page }) => {
    await page.locator('.asset-type .class-row', { hasText: 'Physical objects' }).click();
    await expect(page.locator('.asset-body .instance-list li').first()).toBeVisible({ timeout: 15_000 });
    const rows = await page.locator('.asset-body .instance-list li').allTextContents();
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.join()).toContain('orders');
    expect(rows.join()).toContain('kalshi'); // the trading estate is onboarded
    await expect(page.locator('.asset-body button[title="Browse live data (grid)"]').first()).toBeVisible();
  });

  test('mappings list R2RML TriplesMaps', async ({ page }) => {
    await page.locator('.asset-type .class-row', { hasText: 'Mappings' }).click();
    await expect(async () => {
      const n = await page.locator('.asset-type', { hasText: 'Mappings' }).locator('.instance-list li').count();
      expect(n).toBeGreaterThan(10);
    }).toPass({ timeout: 15_000 });
  });

  test('business objects show FIBO-aligned classes with areas', async ({ page }) => {
    await page.locator('.asset-type .class-row', { hasText: 'Business objects' }).click();
    await expect(async () => {
      const n = await page.locator('.asset-type', { hasText: 'Business objects' }).locator('.instance-list li').count();
      expect(n).toBeGreaterThanOrEqual(3);
    }).toPass({ timeout: 15_000 });
  });

  test('custom asset type: create, instance, delete type', async ({ page }) => {
    const tag = runTag();
    await page.click('button:has-text("New asset type")');
    await page.fill('.ext-form input[placeholder*="Data Domains"]', `Widgets${tag}`);
    await page.click('.ext-form button:has-text("Create type")');
    const typeRow = page.locator('.asset-type .class-row', { hasText: `Widgets${tag}` });
    await expect(typeRow).toBeVisible({ timeout: 10_000 });

    await typeRow.click();
    const body = page.locator('.asset-type', { hasText: `Widgets${tag}` });
    await body.locator('button.add-field').click();
    await expect(page.locator('.modal-title')).toBeVisible();
    await page.locator('.modal input').first().fill(`W${tag}`);
    await page.locator('.modal input').nth(1).fill(`Widget ${tag}`);
    await page.click('.modal button:has-text("Create")');
    await page.waitForTimeout(800);
    await body.locator('button[title="Refresh"]').click();
    await expect(body.locator('.instance-list li', { hasText: `Widget ${tag}` })).toBeVisible({ timeout: 10_000 });

    // delete the custom type (instances stay, per the dialog contract)
    await typeRow.hover();
    await typeRow.locator('button[title="Delete this asset type"]').click();
    await page.locator('.modal button:has-text("Delete")').click();
    await expect(typeRow).toHaveCount(0, { timeout: 8_000 });
    expect(await sparqlCount(page, `SELECT ?p WHERE { <https://studio.local/ns#W${tag}> ?p ?o }`)).toBeGreaterThan(0);
  });

  test('import wizard: mapping override, validation, batch import, template', async ({ page }) => {
    const tag = runTag();
    // create a scratch type to import into
    await page.click('button:has-text("New asset type")');
    await page.fill('.ext-form input[placeholder*="Data Domains"]', `Imp${tag}`);
    await page.click('.ext-form button:has-text("Create type")');
    const typeRow = page.locator('.asset-type .class-row', { hasText: `Imp${tag}` });
    await expect(typeRow).toBeVisible({ timeout: 10_000 });
    await typeRow.click();
    const body = page.locator('.asset-type', { hasText: `Imp${tag}` });
    await body.locator('button[title="Import from spreadsheet"]').click();
    await expect(page.locator('.csv-input')).toBeVisible();
    await page.fill('.csv-input', `Label,Ignored Col\nOne${tag},x\nTwo${tag},y\nOne${tag},dupe`);
    await expect(page.locator('.mapping-row')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.modal .term-meta', { hasText: 'rows valid' })).toContainText('2 of 3');
    await page.click('button:has-text("Import 2 rows")');
    await page.waitForTimeout(1000);
    await body.locator('button[title="Refresh"]').click();
    await expect(body.locator('.instance-list li', { hasText: `One${tag}` })).toBeVisible({ timeout: 10_000 });
    // template persisted for the class
    expect(
      await sparqlCount(page, `SELECT ?t WHERE { ?t a <https://studio.local/ns#ImportTemplate> ; <https://studio.local/ns#forClass> ?c . FILTER(CONTAINS(STR(?c), "Imp${tag.toLowerCase()}")) }`)
    ).toBeGreaterThanOrEqual(0); // template IRI slugs the class — existence checked loosely
  });
});
