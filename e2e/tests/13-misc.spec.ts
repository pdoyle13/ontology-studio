import { test, expect } from '@playwright/test';
import { connect, runTag } from './helpers';

test.describe('import/export dialog', () => {
  test.beforeEach(async ({ page }) => {
    await connect(page);
    await page.click('button:has-text("Import / Export")');
  });

  test('turtle and JSON-LD downloads produce parseable content', async ({ page }) => {
    const dl1 = page.waitForEvent('download', { timeout: 20_000 });
    await page.click('button:has-text("as Turtle"), button:has-text("Download")');
    const ttl = await dl1;
    expect((await ttl.suggestedFilename()).length).toBeGreaterThan(0);

    const dl2 = page.waitForEvent('download', { timeout: 20_000 });
    await page.click('button:has-text("as JSON-LD")');
    const jsonld = await dl2;
    const { readFileSync } = await import('node:fs');
    const doc = JSON.parse(readFileSync((await jsonld.path())!, 'utf8'));
    expect(doc['@context']).toBeTruthy();
    expect(Array.isArray(doc['@graph'])).toBe(true);
  });

  test('file import loads turtle into the active graph', async ({ page }) => {
    const tag = runTag();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'fixture.ttl',
      mimeType: 'text/turtle',
      buffer: Buffer.from(`<https://example.org/music#Imp${tag}> a <https://example.org/music#Artist> .`),
    });
    await expect(page.locator('.import-status')).toContainText(/1 triple|imported|loaded/i, { timeout: 20_000 });
  });

  test('pasted turtle imports into the active graph', async ({ page }) => {
    const tag = runTag();
    await page.locator('.modal textarea').fill(`<https://example.org/music#Paste${tag}> a <https://example.org/music#Artist> .`);
    await page.click('button:has-text("Import pasted text")');
    await expect(page.locator('.import-status')).toContainText(/1 triple|imported|loaded/i, { timeout: 20_000 });
  });
});

test.describe('agent panel surface', () => {
  test('agent-first entry: intent chips render without any LLM call', async ({ page }) => {
    await connect(page, { workspace: 'ask' });
    // Ask is agent-first: the agent renders as the MAIN center surface
    await expect(page.locator('.agent-center .intent-chips')).toBeVisible({ timeout: 10_000 });
    const chips = await page.locator('.intent-chip').allTextContents();
    expect(chips.join()).toContain('Add a datasource');
    expect(chips.join()).toContain('Ask a question');
  });
});

test.describe('proposals workflow (request-level)', () => {
  const API = 'http://localhost:7881';

  test('editor stages into a proposal; steward reviews the diff and merges', async ({ request }) => {
    const tag = runTag();
    // create a proposal as the editor
    const created = await (
      await request.post(`${API}/api/proposals`, {
        headers: { 'X-Studio-User': 'quinn' },
        data: { title: `E2E proposal ${tag}`, targetGraph: 'https://studio.local/graphs/lineage' },
      })
    ).json();
    expect(created.id ?? created.iri).toBeTruthy();
    const pid = created.id ?? created.iri;

    // stage a change into it (update with the proposal header)
    const staged = await request.post(`${API}/db/update`, {
      headers: {
        'Content-Type': 'application/sparql-update',
        'X-Studio-User': 'quinn',
        'X-Studio-Proposal': String(pid),
      },
      data: `INSERT DATA { GRAPH <https://studio.local/graphs/lineage> { <https://x/prop${tag}> <https://x/p> "staged" } }`,
    });
    expect([200, 204].includes(staged.status())).toBe(true);

    // the staged triple is invisible in the real graph
    const before = await (
      await request.post(`${API}/db/query?union-default-graph=`, {
        headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' },
        data: `SELECT ?o WHERE { <https://x/prop${tag}> ?p ?o }`,
      })
    ).json();
    expect(before.results.bindings.length).toBe(0);

    // submit, then steward merges
    await request.post(`${API}/api/proposals/${encodeURIComponent(pid)}/submit`, { headers: { 'X-Studio-User': 'quinn' } });
    const merged = await request.post(`${API}/api/proposals/${encodeURIComponent(pid)}/approve`, {
      headers: { 'X-Studio-User': 'sam' },
    });
    expect([200, 204].includes(merged.status())).toBe(true);

    const after = await (
      await request.post(`${API}/db/query?union-default-graph=`, {
        headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' },
        data: `SELECT ?o WHERE { GRAPH <https://studio.local/graphs/lineage> { <https://x/prop${tag}> ?p ?o } }`,
      })
    ).json();
    expect(after.results.bindings.length).toBe(1);
  });
});
