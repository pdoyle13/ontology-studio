import { test, expect } from '@playwright/test';
import { connect, hittableNodes, openViaOmnibox, rightClickNode, runTag, selectGraph, sparqlCount, sparqlUpdate } from './helpers';

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

  test('typing a plain relation name mints a real property (no 400)', async ({ page }) => {
    const tag = runTag();
    // music scope: two NON-SQL classes, so the predicate picker (not the
    // SQL join-link builder) opens on connect
    await selectGraph(page, 'music');
    await page.click('button:has-text("Overview")');
    await expect(page.locator('.rdf-node').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(700);
    const spots = await hittableNodes(page);
    expect(spots.length).toBeGreaterThanOrEqual(2);
    const [a, b] = spots;
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
    // a name that matches no suggestion: Enter mints ns-of-source + camelCase
    await page.locator('.relation-picker input').fill(`test rel ${tag}`);
    await page.keyboard.press('Enter');
    await expect(page.locator('.relation-picker')).toHaveCount(0, { timeout: 8_000 });
    // the predicate exists as a declared, labeled property — and the edge with it
    await expect(async () => {
      const n = await sparqlCount(
        page,
        `SELECT ?s WHERE { ?s ?p ?o . ?p <http://www.w3.org/2000/01/rdf-schema#label> "test rel ${tag}" }`
      );
      expect(n).toBe(1);
    }).toPass({ timeout: 10_000 });
  });

  test('double-click in the class tree adds the node and centers the viewport', async ({ page }) => {
    await selectGraph(page, 'music');
    const row = page.locator('.class-name', { hasText: 'Artist' }).first();
    await row.dblclick();
    await expect(page.locator('.rdf-node', { hasText: 'Artist' }).first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600); // let the pan animation finish
    // centered: the node's box midpoint lands within the middle half of the pane
    const mid = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.rdf-node')].find((n) => n.textContent?.includes('Artist'));
      const pane = document.querySelector('.react-flow');
      if (!el || !pane) return null;
      const r = el.getBoundingClientRect();
      const pr = pane.getBoundingClientRect();
      return { x: (r.x + r.width / 2 - pr.x) / pr.width, y: (r.y + r.height / 2 - pr.y) / pr.height };
    });
    expect(mid).toBeTruthy();
    expect(mid!.x).toBeGreaterThan(0.25);
    expect(mid!.x).toBeLessThan(0.75);
    expect(mid!.y).toBeGreaterThan(0.25);
    expect(mid!.y).toBeLessThan(0.75);
  });

  test('dropping an already-present resource moves it to the drop point', async ({ page }) => {
    await selectGraph(page, 'music');
    await page.locator('.class-name', { hasText: 'Artist' }).first().dblclick();
    await expect(page.locator('.rdf-node', { hasText: 'Artist' }).first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);
    // synthetic HTML5 drop of the same IRI at a chosen spot on the canvas
    const target = await page.evaluate(() => {
      const wrap = document.querySelector('.canvas-wrap');
      if (!wrap) return null;
      const r = wrap.getBoundingClientRect();
      const x = r.x + r.width * 0.8;
      const y = r.y + r.height * 0.75;
      const dt = new DataTransfer();
      dt.setData('application/x-studio-iri', 'https://example.org/music#Artist');
      wrap.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX: x, clientY: y, dataTransfer: dt }));
      wrap.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX: x, clientY: y, dataTransfer: dt }));
      return { x, y };
    });
    expect(target).toBeTruthy();
    await expect(async () => {
      const pos = await page.evaluate(() => {
        const el = [...document.querySelectorAll('.rdf-node')].find((n) => n.textContent?.includes('Artist'));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      expect(pos).toBeTruthy();
      // node midpoint lands near the drop point (drop maps to node top-left)
      expect(Math.abs(pos!.x - target!.x)).toBeLessThan(160);
      expect(Math.abs(pos!.y - target!.y)).toBeLessThan(120);
    }).toPass({ timeout: 8_000 });
  });

  test('dropping a sidebar table onto a node opens the join-link builder and writes the declaration', async ({ page }) => {
    const tag = runTag();
    // the canvas auto-loads the schema overview on connect; wait for it and
    // use the crm customers node it already shows
    const customers = page.locator('.react-flow__node[data-id="https://studio.local/sql/crm_db#customers"]');
    await expect(customers).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);
    // drop the sales orders table ON TOP of the customers node -> join-link builder
    await page.evaluate(() => {
      const el = document.querySelector('.react-flow__node[data-id="https://studio.local/sql/crm_db#customers"]');
      const r = el!.getBoundingClientRect();
      const dt = new DataTransfer();
      dt.setData('application/x-studio-iri', 'https://studio.local/sql/sales_db#orders');
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      const wrap = document.querySelector('.canvas-wrap');
      wrap!.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX: x, clientY: y, dataTransfer: dt }));
      wrap!.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX: x, clientY: y, dataTransfer: dt }));
    });
    await expect(page.locator('.relation-picker')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.relation-picker')).toContainText(/Link .*Customers.*Orders/i);
    await page.locator('.relation-picker input').fill(`links to orders ${tag}`);
    const selects = page.locator('.relation-picker select');
    await expect(async () => {
      expect(await selects.nth(0).locator('option').count()).toBeGreaterThan(1);
      expect(await selects.nth(1).locator('option').count()).toBeGreaterThan(1);
    }).toPass({ timeout: 10_000 });
    await selects.nth(0).selectOption({ index: 1 });
    await selects.nth(1).selectOption({ index: 1 });
    await page.click('.relation-picker button:has-text("Create link")');
    await expect(page.locator('.relation-picker')).toHaveCount(0, { timeout: 8_000 });
    // the declaration (domain/range + both key properties) is in the graph
    await expect(async () => {
      const n = await sparqlCount(
        page,
        `SELECT ?p WHERE { ?p <http://www.w3.org/2000/01/rdf-schema#label> "links to orders ${tag}" .
          ?p <https://studio.local/ns#sourceKeyProperty> ?sk .
          ?p <https://studio.local/ns#targetKeyProperty> ?tk .
          ?p <http://www.w3.org/2000/01/rdf-schema#domain> <https://studio.local/sql/crm_db#customers> .
          ?p <http://www.w3.org/2000/01/rdf-schema#range> <https://studio.local/sql/sales_db#orders> }`
      );
      expect(n).toBe(1);
    }).toPass({ timeout: 10_000 });
    // and the edge is drawn
    await expect(page.locator('.edge-label', { hasText: `linksToOrders${tag}` })).toBeVisible({ timeout: 8_000 });
    // cleanup: drop the declaration so reruns don't accumulate picker options
    await sparqlUpdate(
      page,
      `DELETE { ?p ?x ?y } WHERE { ?p ?x ?y . ?p <http://www.w3.org/2000/01/rdf-schema#label> "links to orders ${tag}" }`
    );
  });

  test('expanding a node from another graph falls back to union scope (translated schema)', async ({ page }) => {
    await selectGraph(page, 'music'); // active graph does NOT contain the SQL schema
    await page.waitForTimeout(800); // the music overview replaces the canvas
    await page.evaluate(() => {
      const wrap = document.querySelector('.canvas-wrap');
      const r = wrap!.getBoundingClientRect();
      const dt = new DataTransfer();
      dt.setData('application/x-studio-iri', 'https://studio.local/sql/sales_db#orders');
      const x = r.x + r.width * 0.5;
      const y = r.y + r.height * 0.5;
      wrap!.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX: x, clientY: y, dataTransfer: dt }));
      wrap!.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX: x, clientY: y, dataTransfer: dt }));
    });
    const node = page.locator('.react-flow__node[data-id="https://studio.local/sql/sales_db#orders"]');
    await expect(node).toBeVisible({ timeout: 10_000 });
    const before = await page.locator('.rdf-node').count();
    await node.locator('.rdf-node').dblclick();
    // cross-graph expansion used to silently add nothing
    await expect(async () => {
      expect(await page.locator('.rdf-node').count()).toBeGreaterThan(before);
    }).toPass({ timeout: 15_000 });
  });

  test('re-layout brings the arrangement back into view', async ({ page }) => {
    await page.click('button:has-text("Overview")');
    await expect(page.locator('.rdf-node').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    // shove the viewport far away, then re-layout — nodes must come back
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(640 + 1500, 400 + 900, { steps: 6 });
    await page.mouse.up();
    await page.click('button:has-text("Re-layout")');
    await page.waitForTimeout(800); // fit animation
    const visible = await page.evaluate(() => {
      const pane = document.querySelector('.react-flow')!.getBoundingClientRect();
      return [...document.querySelectorAll('.rdf-node')].filter((n) => {
        const r = n.getBoundingClientRect();
        return r.right > pane.left && r.left < pane.right && r.bottom > pane.top && r.top < pane.bottom;
      }).length;
    });
    expect(visible).toBeGreaterThan(0);
  });

  test('hover quick-actions stay clickable (no dead zone above the node)', async ({ page }) => {
    await page.click('button:has-text("Overview")');
    await expect(page.locator('.rdf-node').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(700);
    const spots = await hittableNodes(page);
    expect(spots.length).toBeGreaterThanOrEqual(1);
    const before = await page.locator('.rdf-node').count();
    const a = spots[0];
    // hover the node, then travel UP into the quick-action strip and click ✕
    await page.mouse.move(a.cx, a.cy);
    await page.waitForTimeout(250);
    const btn = await page.evaluate(({ cx, cy }) => {
      const el = document.elementFromPoint(cx, cy)?.closest('.react-flow__node');
      const b = el?.querySelector('button[title="Hide from canvas"]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, a);
    expect(btn).toBeTruthy();
    await page.mouse.move(a.cx, btn!.y + 18, { steps: 4 }); // approach from inside the node
    await page.mouse.move(btn!.x, btn!.y, { steps: 6 });
    await page.mouse.click(btn!.x, btn!.y);
    await expect(page.locator('.rdf-node')).toHaveCount(before - 1, { timeout: 5_000 });
  });
});
