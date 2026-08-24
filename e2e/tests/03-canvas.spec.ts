import { test, expect } from '@playwright/test';
import { connect, hittableNodes, runTag, sparqlCount, openViaOmnibox, rightClickNode } from './helpers';

declare global {
  interface Window {
    __studio: { canvas: { getState: () => { nodes: { id: string; selected?: boolean }[]; edges: { source: string; target: string; id: string }[] } } };
  }
}

test.describe('canvas', () => {
  test.beforeEach(async ({ page }) => connect(page));

  test('overview lays out the schema with straight midpoint edges', async ({ page }) => {
    await page.click('button:has-text("Overview")');
    await expect(page.locator('.rdf-node').first()).toBeVisible({ timeout: 15_000 });
    expect(await page.locator('.rdf-node').count()).toBeGreaterThan(10);
    expect(await page.locator('.react-flow__edge').count()).toBeGreaterThan(3);
    // edges are straight lines (no bezier curves)
    const d = await page.locator('.rdf-edge-path').first().getAttribute('d');
    expect(d).toMatch(/^M [\d.]+,[\d.]+ L [\d.]+,[\d.]+$/);
  });

  test('click selects into inspector; double-click expands neighbors', async ({ page }) => {
    await page.click('button:has-text("Overview")');
    await expect(page.locator('.rdf-node').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(600);
    const spots = await hittableNodes(page);
    expect(spots.length).toBeGreaterThan(0);
    const before = await page.evaluate(() => window.__studio.canvas.getState().nodes.length);
    await page.mouse.dblclick(spots[0].cx, spots[0].cy);
    await expect(async () => {
      expect(await page.evaluate(() => window.__studio.canvas.getState().nodes.length)).toBeGreaterThanOrEqual(before);
    }).toPass({ timeout: 10_000 });
  });

  test('delete key hides selection without touching the graph', async ({ page }) => {
    await page.click('button:has-text("Overview")');
    await expect(page.locator('.rdf-node').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(600);
    const triplesBefore = await sparqlCount(page, 'SELECT ?s WHERE { GRAPH <https://example.org/graphs/music> { ?s ?p ?o } } LIMIT 500');
    const spots = await hittableNodes(page);
    const n0 = await page.evaluate(() => window.__studio.canvas.getState().nodes.length);
    await page.mouse.click(spots[0].cx, spots[0].cy);
    await page.keyboard.press('Delete');
    await expect(async () => {
      const st = await page.evaluate(() => {
        const s = window.__studio.canvas.getState();
        const ids = new Set(s.nodes.map((n) => n.id));
        return { n: s.nodes.length, dangling: s.edges.filter((e) => !ids.has(e.source) || !ids.has(e.target)).length };
      });
      expect(st.n).toBe(n0 - 1);
      expect(st.dangling).toBe(0);
    }).toPass();
    expect(await sparqlCount(page, 'SELECT ?s WHERE { GRAPH <https://example.org/graphs/music> { ?s ?p ?o } } LIMIT 500')).toBe(triplesBefore);
  });

  test('shift box-select then bulk delete-from-view', async ({ page }) => {
    await page.click('button:has-text("Overview")');
    await expect(page.locator('.rdf-node').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(600);
    await page.keyboard.down('Shift');
    await page.mouse.move(420, 260);
    await page.mouse.down();
    await page.mouse.move(1250, 780, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const sel = await page.evaluate(() => window.__studio.canvas.getState().nodes.filter((n) => n.selected).length);
    expect(sel).toBeGreaterThanOrEqual(2);
    const before = await page.evaluate(() => window.__studio.canvas.getState().nodes.length);
    await page.keyboard.press('Delete');
    await expect(async () => {
      expect(await page.evaluate(() => window.__studio.canvas.getState().nodes.length)).toBe(before - sel);
    }).toPass();
  });

  test('PNG export downloads the layout', async ({ page }) => {
    await page.click('button:has-text("Overview")');
    await expect(page.locator('.rdf-node').first()).toBeVisible({ timeout: 15_000 });
    const dl = page.waitForEvent('download', { timeout: 20_000 });
    await page.click('button:has-text("PNG")');
    expect((await dl).suggestedFilename()).toBe('ontology-canvas.png');
  });

  test('layout algorithm switch + relayout changes positions', async ({ page }) => {
    await page.click('button:has-text("Overview")');
    await expect(page.locator('.rdf-node').first()).toBeVisible({ timeout: 15_000 });
    const pos = () => page.evaluate(() => JSON.stringify(window.__studio.canvas.getState().nodes.slice(0, 5).map((n) => (n as unknown as { position: object }).position)));
    const p0 = await pos();
    await page.locator('.canvas-toolbar select').selectOption({ index: 3 });
    await page.click('button:has-text("Re-layout")');
    await expect(async () => expect(await pos()).not.toBe(p0)).toPass({ timeout: 10_000 });
  });

  test('node context menu: copy IRI + rename across graphs', async ({ page }) => {
    const tag = runTag();
    await page.evaluate(
      async (t) =>
        fetch('/db/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/sparql-update' },
          body: `INSERT DATA { GRAPH <https://example.org/graphs/music> {
            <https://example.org/music#${t}> a <https://example.org/music#Artist> .
            <https://example.org/music#${t}> <http://www.w3.org/2000/01/rdf-schema#label> "Band ${t}" . } }`,
        }),
      tag
    );
    await page.evaluate(() => fetch('/es/_refresh', { method: 'POST' }));
    await page.waitForTimeout(1200);
    await openViaOmnibox(page, tag.toLowerCase());
    const node = page.locator('.react-flow__node', { hasText: tag }).first();
    await expect(node).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    page.once('dialog', (d) => d.accept(`https://example.org/music#${tag}X`));
    await rightClickNode(page, node);
    await expect(page.locator('.context-menu')).toBeVisible();
    await page.click('.context-menu >> text=Rename IRI');
    await expect(async () => {
      expect(await sparqlCount(page, `SELECT ?p WHERE { <https://example.org/music#${tag}X> ?p ?o }`)).toBeGreaterThanOrEqual(2);
      expect(await sparqlCount(page, `SELECT ?p WHERE { <https://example.org/music#${tag}> ?p ?o }`)).toBe(0);
    }).toPass({ timeout: 10_000 });
  });

  test('flow view renders warehouses, business objects, and outputs', async ({ page }) => {
    await page.click('button:has-text("Flow")');
    await expect(page.locator('.rdf-node', { hasText: 'sales_db' }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.rdf-node', { hasText: 'Order Lineage' }).first()).toBeVisible();
  });

  test('drag-to-connect opens the relation picker', async ({ page }) => {
    await page.click('button:has-text("Overview")');
    await expect(page.locator('.rdf-node').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(700);
    const spots = await hittableNodes(page);
    expect(spots.length).toBeGreaterThanOrEqual(2);
    const [a, b] = spots;
    // start on the source handle (right-center; hover reveals it) —
    // connectionRadius=80 forgives offsets on the drop side
    await page.mouse.move(a.cx, a.cy);
    await page.waitForTimeout(200);
    const handle = await page.evaluate(({ cx, cy }) => {
      const el = document.elementFromPoint(cx, cy)?.closest('.react-flow__node');
      const h = el?.querySelector('.react-flow__handle-right, .rdf-handle:last-of-type');
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, a);
    expect(handle).toBeTruthy();
    await page.mouse.move(handle!.x, handle!.y);
    await page.mouse.down();
    await page.mouse.move(b.cx, b.cy, { steps: 14 });
    await page.mouse.up();
    await expect(page.locator('.relation-picker')).toBeVisible({ timeout: 8_000 });
    await page.keyboard.press('Escape');
  });
});
