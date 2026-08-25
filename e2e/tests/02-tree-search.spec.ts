import { test, expect } from '@playwright/test';
import { connect, openTab, openViaOmnibox, selectGraph } from './helpers';

test.describe('class tree', () => {
  test.beforeEach(async ({ page }) => connect(page));

  test('lists domain classes with live counts, no system vocab', async ({ page }) => {
    await expect(page.locator('.class-row').first()).toBeVisible({ timeout: 20_000 });
    const rows = await page.locator('.class-row .class-name').allTextContents();
    expect(rows).toContain('Orders');
    expect(rows).toContain('Album');
    for (const banned of ['Concept Scheme', 'Node Shape', 'Triples Map', 'Proposal', 'User']) {
      expect(rows).not.toContain(banned);
    }
    const orderCount = await page.locator('.class-row', { hasText: 'Orders' }).first().locator('.count').textContent();
    expect(Number(orderCount?.replace(/\D/g, ''))).toBeGreaterThan(100);
  });

  test('expanding a virtual class pages instances at 50', async ({ page }) => {
    const row = page.locator('.class-row', { hasText: 'Delivery Events' }).first();
    await row.locator('.twisty').click();
    await expect(page.locator('.instance-list li').first()).toBeVisible({ timeout: 20_000 });
    const more = page.locator('.instance-list button.micro', { hasText: 'more' });
    await expect(more).toHaveCount(1);
    const before = await page.locator('.instance-list li').count();
    await more.click();
    await expect(async () => {
      expect(await page.locator('.instance-list li').count()).toBeGreaterThan(before);
    }).toPass();
  });

  test('tree search narrows to matching resources', async ({ page }) => {
    await page.fill('.search-box', 'Radiohead');
    await expect(page.locator('.instance-list li', { hasText: 'Radiohead' }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('virtual class rows carry a grid button', async ({ page }) => {
    const row = page.locator('.class-row', { hasText: 'Customers' }).first();
    await expect(row.locator('button[title="Browse live data (grid)"]')).toBeVisible();
  });
});

test.describe('omnibox search', () => {
  test.beforeEach(async ({ page }) => connect(page));

  test('finds live rows across databases with facets and highlights', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.fill('.omnibox-input', 'turing');
    await expect(page.locator('.omnibox-hit').first()).toBeVisible({ timeout: 10_000 });
    const hits = await page.locator('.omnibox-hit').allTextContents();
    expect(hits.filter((h) => h.includes('Alan Turing')).length).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.facet', { hasText: /^data/ }).first()).toBeVisible();
  });

  test('kind facet filters the result groups', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.fill('.omnibox-input', 'payments');
    await expect(page.locator('.omnibox-hit').first()).toBeVisible({ timeout: 10_000 });
    const modelFacet = page.locator('.facet', { hasText: /^model/ }).first();
    if ((await modelFacet.count()) > 0) {
      await modelFacet.click();
      await expect(async () => {
        const groups = await page.locator('.omnibox-group').allTextContents();
        expect(groups).toEqual(['Model']);
      }).toPass({ timeout: 8_000 });
    }
  });

  test('enter opens the hit in the inspector', async ({ page }) => {
    await openViaOmnibox(page, 'rilke');
    await expect(page.locator('.entity-meta')).toBeVisible({ timeout: 10_000 });
  });

  test('escape closes; keyboard navigation moves the active row', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.fill('.omnibox-input', 'orders');
    await expect(page.locator('.omnibox-hit').first()).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.omnibox-hit.active')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.omnibox-input')).toHaveCount(0);
  });
});

test.describe('shapes & issues tabs', () => {
  test('shapes tab lists node shapes with target classes', async ({ page }) => {
    await connect(page);
    await openTab(page, 'Shapes');
    await expect(page.locator('.instance-list li').first()).toBeVisible({ timeout: 10_000 });
    const first = await page.locator('.instance-list li').first().textContent();
    expect(first).toMatch(/props/);
  });

  test('SHACL validation runs on a scoped graph', async ({ page }) => {
    await connect(page);
    await selectGraph(page, 'music');
    await openTab(page, 'Issues');
    await page.click('button:has-text("Run SHACL validation")');
    await expect(page.locator('text=/conforms|result\\(s\\) over/')).toBeVisible({ timeout: 45_000 });
  });

  test('SHACL validation over union scope completes per graph (no crash, no hang)', async ({ page }) => {
    await connect(page);
    // no graph selected = union scope; validated graph-by-graph so same-IRI
    // shapes in different graphs never merge. Oversized scopes fail fast with
    // a "too large to validate" message instead of hanging — either outcome
    // must arrive promptly.
    await openTab(page, 'Issues');
    await page.click('button:has-text("Run SHACL validation")');
    await expect(page.locator('text=/conforms|result\\(s\\) over|too large to validate/')).toBeVisible({ timeout: 45_000 });
  });
});
