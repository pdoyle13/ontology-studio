import { test, expect } from '@playwright/test';
import { connect, openTab, runTag } from './helpers';

const API = 'http://localhost:7881';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';

test.describe('crosswalks (request-level)', () => {
  test('suggest → accept → list → remove, with role gating', async ({ request }) => {
    const tag = runTag();
    const G = `https://example.org/graphs/xwalk-${tag}`;
    const schemeA = `https://example.org/xw/${tag}/a`;
    const schemeB = `https://example.org/xw/${tag}/b`;
    const mk = (scheme: string, iri: string, label: string, alt?: string) =>
      `<${iri}> <${SKOS}inScheme> <${scheme}> ; <${SKOS}prefLabel> "${label}" ${alt ? `; <${SKOS}altLabel> "${alt}"` : ''} .`;

    const seed = await request.post(`${API}/db/update`, {
      headers: { 'Content-Type': 'application/sparql-update', 'X-Studio-User': 'pat' },
      data: `INSERT DATA { GRAPH <${G}> {
        ${mk(schemeA, `${schemeA}#car`, 'Car')}
        ${mk(schemeA, `${schemeA}#truck`, 'Heavy Truck')}
        ${mk(schemeA, `${schemeA}#bike`, 'Bicycle')}
        ${mk(schemeB, `${schemeB}#auto`, 'Automobile', 'Car')}
        ${mk(schemeB, `${schemeB}#truck`, 'Heavy Goods Truck')}
      } }`,
    });
    expect([200, 204]).toContain(seed.status());

    // suggestions: exact via altLabel, fuzzy via token overlap
    const sug = await (await request.get(`${API}/api/crosswalk/suggest?from=${encodeURIComponent(schemeA)}&to=${encodeURIComponent(schemeB)}`)).json();
    const pairs = sug.suggestions.map((s: { fromLabel: string; toLabel: string; basis: string }) => `${s.fromLabel}→${s.toLabel}:${s.basis}`);
    expect(pairs).toContain('Car→Automobile:label-exact');
    expect(pairs.join()).toContain('Heavy Truck→Heavy Goods Truck:token-overlap');

    // viewers may not accept
    const denied = await request.post(`${API}/api/crosswalk`, {
      headers: { 'X-Studio-User': 'rando-viewer' },
      data: { from: `${schemeA}#car`, to: `${schemeB}#auto` },
    });
    expect(denied.status()).toBe(403);

    // editor accepts; the pair leaves the suggestion list and shows in existing
    const ok = await (
      await request.post(`${API}/api/crosswalk`, {
        headers: { 'X-Studio-User': 'quinn' },
        data: { from: `${schemeA}#car`, to: `${schemeB}#auto`, relation: 'exactMatch' },
      })
    ).json();
    expect(ok.relation).toBe('exactMatch');
    const after = await (await request.get(`${API}/api/crosswalk/suggest?from=${encodeURIComponent(schemeA)}&to=${encodeURIComponent(schemeB)}`)).json();
    expect(after.existing).toEqual([{ from: `${schemeA}#car`, relation: 'exactMatch', to: `${schemeB}#auto` }]);
    expect(after.suggestions.some((s: { from: string }) => s.from === `${schemeA}#car`)).toBe(false);

    // bogus relation rejected
    const badRel = await request.post(`${API}/api/crosswalk`, {
      headers: { 'X-Studio-User': 'quinn' },
      data: { from: `${schemeA}#bike`, to: `${schemeB}#auto`, relation: 'bestMatch' },
    });
    expect(badRel.status()).toBe(400);

    // remove + cleanup
    const rm = await request.delete(`${API}/api/crosswalk`, {
      headers: { 'X-Studio-User': 'quinn' },
      data: { from: `${schemeA}#car`, to: `${schemeB}#auto`, relation: 'exactMatch' },
    });
    expect(rm.status()).toBe(200);
    const cleanup = await request.post(`${API}/db/update`, {
      headers: { 'Content-Type': 'application/sparql-update', 'X-Studio-User': 'pat' },
      data: `DROP SILENT GRAPH <${G}>`,
    });
    expect([200, 204]).toContain(cleanup.status());
  });

  test('taxonomy Crosswalk dialog: suggest, accept, mapping listed', async ({ page, request }) => {
    const tag = runTag();
    const G = 'https://example.org/graphs/music'; // schemes must be in the ACTIVE graph for the panel
    const schemeA = `https://example.org/xwui/${tag}/a`;
    const schemeB = `https://example.org/xwui/${tag}/b`;
    const seed = await request.post(`${API}/db/update`, {
      headers: { 'Content-Type': 'application/sparql-update', 'X-Studio-User': 'pat' },
      data: `INSERT DATA { GRAPH <${G}> {
        <${schemeA}> a <${SKOS}ConceptScheme> ; <${SKOS}prefLabel> "XW A ${tag}" .
        <${schemeB}> a <${SKOS}ConceptScheme> ; <${SKOS}prefLabel> "XW B ${tag}" .
        <${schemeA}#jazz> <${SKOS}inScheme> <${schemeA}> ; <${SKOS}prefLabel> "Jazz Music" .
        <${schemeB}#jazz> <${SKOS}inScheme> <${schemeB}> ; <${SKOS}prefLabel> "Jazz Music" .
      } }`,
    });
    expect([200, 204]).toContain(seed.status());
    try {
      await connect(page);
      const { selectGraph } = await import('./helpers');
      await selectGraph(page, 'music');
      await openTab(page, 'Taxonomy');
      await page.locator('.skos-toolbar select').selectOption({ label: `XW A ${tag} (1)` });
      await page.click('button:has-text("⇄ Crosswalk")');
      await expect(page.locator('.modal-title', { hasText: 'Crosswalk' })).toBeVisible({ timeout: 8_000 });
      // pick the B scheme as target
      await page.locator('.modal select').first().selectOption({ label: `XW B ${tag}` });
      const row = page.locator('.crosswalk-list .ext-row', { hasText: 'Jazz Music' }).first();
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.locator('button[title*="Accept"]').click();
      // moves from suggestions to existing mappings
      await expect(page.locator('.crosswalk-list .ext-row', { hasText: 'skos:exactMatch' })).toBeVisible({ timeout: 10_000 });
    } finally {
      await request.post(`${API}/db/update`, {
        headers: { 'Content-Type': 'application/sparql-update', 'X-Studio-User': 'pat' },
        data: `DELETE { GRAPH <${G}> { ?s ?p ?o } } WHERE { GRAPH <${G}> { ?s ?p ?o FILTER(STRSTARTS(STR(?s), "https://example.org/xwui/${tag}/")) } } ; DELETE WHERE { GRAPH <https://studio.local/graphs/crosswalks> { <${schemeA}#jazz> ?p ?o } }`,
      });
    }
  });
});
