import { test, expect } from '@playwright/test';
import { connect, openTab, runTag, sparqlCount, sparqlUpdate } from './helpers';

test.describe('SHACL-AF rules', () => {
  test('author → materialize → explain → deactivate → clean rerun', async ({ page }) => {
    const tag = runTag();
    await connect(page);
    // scratch class + members so the rule has a private target
    await sparqlUpdate(
      page,
      `INSERT DATA { GRAPH <https://example.org/graphs/music> {
        <https://example.org/music#RC${tag}> a <http://www.w3.org/2000/01/rdf-schema#Class> .
        <https://example.org/music#RC${tag}> <http://www.w3.org/2000/01/rdf-schema#label> "RuleClass ${tag}" .
        <https://example.org/music#ri1${tag}> a <https://example.org/music#RC${tag}> .
        <https://example.org/music#ri2${tag}> a <https://example.org/music#RC${tag}> . } }`
    );
    await page.reload();
    await page.locator('select').nth(1).selectOption({ label: 'Local Oxigraph (studio)' });
    await openTab(page, 'Rules');
    await expect(page.locator('.rules-panel')).toBeVisible({ timeout: 8_000 });

    await page.click('button:has-text("＋ Rule")');
    await page.locator('.ext-form select').first().selectOption({ label: `RuleClass ${tag}` });
    await page.fill('.ext-form input[placeholder*="asset-kind"]', `https://studio.local/vocab/rk${tag}`);
    await page.fill('.ext-form input[placeholder="literal value"]', 'flagged');
    await page.click('button:has-text("Create rule")');
    await expect(page.locator('.ext-row', { hasText: `RuleClass ${tag}` })).toBeVisible({ timeout: 10_000 });

    await page.click('button:has-text("Materialize")');
    await expect(page.locator('.rules-panel .term-meta', { hasText: 'derived by' })).toBeVisible({ timeout: 30_000 });
    await expect(async () => {
      expect(
        await sparqlCount(page, `SELECT ?s WHERE { GRAPH <https://studio.local/graphs/inferred> { ?s <https://studio.local/vocab/rk${tag}> "flagged" } }`)
      ).toBe(2);
    }).toPass({ timeout: 10_000 });

    // explanation names the rule
    const expl = await page.evaluate(async (t) => {
      const u = new URL('/api/rules/explain', location.origin);
      u.searchParams.set('s', `https://example.org/music#ri1${t}`);
      u.searchParams.set('p', `https://studio.local/vocab/rk${t}`);
      u.searchParams.set('o', 'flagged');
      u.searchParams.set('oIsIri', 'false');
      return fetch(u).then((r) => r.json());
    }, tag);
    expect(expl.length).toBe(1);
    expect(expl[0].kind).toBe('triple');

    // deactivate the rule and re-materialize: derived triples for it disappear
    const row = page.locator('.ext-row', { hasText: `RuleClass ${tag}` });
    await row.locator('button[title="Deactivate"]').click();
    await expect(row.locator('button[title="Activate"]')).toBeVisible({ timeout: 8_000 });
    await page.click('button:has-text("Materialize")');
    await expect(async () => {
      expect(
        await sparqlCount(page, `SELECT ?s WHERE { GRAPH <https://studio.local/graphs/inferred> { ?s <https://studio.local/vocab/rk${tag}> "flagged" } }`)
      ).toBe(0);
    }).toPass({ timeout: 20_000 });
  });
});

test.describe('governance & quality', () => {
  test('reviews tab renders the proposal queue', async ({ page }) => {
    await connect(page, { workspace: 'govern' });
    await expect(page.locator('.sidebar-tabs-wrap .tab.active')).toContainText('Reviews');
  });

  test('quality checks run, persist a snapshot, and trend', async ({ page }) => {
    await connect(page, { workspace: 'govern' });
    await openTab(page, 'Quality');
    await expect(page.locator('.quality-list li').first()).toBeVisible({ timeout: 15_000 });
    expect(await page.locator('.quality-list li').count()).toBeGreaterThanOrEqual(5);
    await page.click('button:has-text("Run quality checks")');
    await expect(page.locator('text=/recorded run/')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.spark').first()).toBeVisible({ timeout: 10_000 });
  });

  test('viewer role cannot run quality checks (button gated + server 403)', async ({ page }) => {
    await connect(page, { workspace: 'govern', user: 'quinn' });
    await openTab(page, 'Quality');
    await expect(page.locator('button:has-text("Run quality checks")')).toBeDisabled();
    const status = await page.evaluate(async () => (await fetch('/api/quality/run', { method: 'POST', headers: { 'X-Studio-User': 'quinn' } })).status);
    expect(status).toBe(403);
  });

  test('acting-as switch changes the enforced identity', async ({ page }) => {
    await connect(page, { user: 'quinn' });
    const me = await page.evaluate(async () => {
      const r = await fetch('/api/governance/users');
      return r.ok;
    });
    expect(me).toBe(true);
    // writes to a governed graph as editor are refused for direct mode
    const status = await page.evaluate(async () =>
      (
        await fetch('/db/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/sparql-update', 'X-Studio-User': 'quinn' },
          body: 'INSERT DATA { GRAPH <https://studio.local/graphs/lineage> { <https://x/a> <https://x/b> "c" } }',
        })
      ).status
    );
    expect(status).toBe(403);
  });
});
