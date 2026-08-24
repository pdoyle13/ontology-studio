// Shared helpers encoding every hard-learned lesson from the ad-hoc E2E era:
// select #0 is the workspace switcher (endpoint picker is #1), acting-as
// switches reload the page, canvas nodes can be occluded (hit-test before
// clicking), and every write-fixture must be unique per run.

import { expect, type Page } from '@playwright/test';

export const runTag = () => `T${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** Connect to the local endpoint in a given workspace, acting as `user`. */
export async function connect(page: Page, { workspace = 'model', user = 'pat' } = {}) {
  await page.goto(`/?workspace=${workspace}`);
  await page.evaluate((u) => localStorage.setItem('studio.actingUser', u), user);
  await page.reload();
  await page.waitForSelector('.workspace-switch', { timeout: 15_000 });
  await page.locator('select').nth(1).selectOption({ label: 'Local Oxigraph (studio)' });
  await expect(page.locator('.sidebar-tabs-wrap .tab').first()).toBeVisible({ timeout: 15_000 });
}

/** Pick the graph whose option text contains `name` (3rd select in the bar). */
export async function selectGraph(page: Page, name: string) {
  const sel = page.locator('.connection-bar select').nth(2);
  let value: string | undefined;
  await expect(async () => {
    value = await sel.locator('option').evaluateAll(
      (els, n) => (els as HTMLOptionElement[]).find((o) => o.textContent?.includes(n))?.value,
      name
    );
    expect(value, `graph option containing "${name}"`).toBeTruthy();
  }).toPass({ timeout: 15_000 });
  await sel.selectOption(value!);
  await page.waitForTimeout(600);
}

/** Open a resource through the omnibox (indexes model + live rows). */
export async function openViaOmnibox(page: Page, query: string) {
  await page.keyboard.press('Control+k');
  await page.fill('.omnibox-input', query);
  await page.waitForSelector('.omnibox-hit', { timeout: 10_000 });
  await page.keyboard.press('Enter');
}

/** Canvas nodes can sit under the connection bar after fitView — return only
 *  centers that actually receive the click. */
export async function hittableNodes(page: Page): Promise<{ cx: number; cy: number }[]> {
  return page.evaluate(() => {
    const out: { cx: number; cy: number }[] = [];
    document.querySelectorAll('.react-flow__node').forEach((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      if (el.contains(document.elementFromPoint(cx, cy))) out.push({ cx, cy });
    });
    return out;
  });
}

/** Direct SPARQL against the store (union scope), for assertions and fixtures. */
export async function sparqlCount(page: Page, query: string): Promise<number> {
  return page.evaluate(async (q) => {
    const r = await fetch('/db/query?union-default-graph=', {
      method: 'POST',
      headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' },
      body: q,
    }).then((x) => x.json());
    return r.results.bindings.length;
  }, query);
}

export async function sparqlUpdate(page: Page, body: string) {
  await page.evaluate(
    async (b) =>
      fetch('/db/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/sparql-update', 'X-Studio-User': 'pat' },
        body: b,
      }),
    body
  );
}

/** Sidebar tab by label; waits for its panel to swap in. */
export async function openTab(page: Page, label: string) {
  await page.click(`.sidebar-tabs-wrap button.tab:has-text("${label}")`);
  await page.waitForTimeout(250);
}

/** Right-click a canvas node at a point that actually hits it; pans the
 *  canvas down once if the node sits under the connection bar. */
export async function rightClickNode(page: Page, node: ReturnType<Page['locator']>) {
  const findSpot = async () => {
    const box = await node.boundingBox();
    if (!box) return null;
    return page.evaluate(({ x, y, w, h }) => {
      const candidates = [
        [x + w / 2, y + h / 2],
        [x + 14, y + h - 10],
        [x + w - 14, y + h - 10],
        [x + w / 2, y + h - 8],
      ];
      for (const [cx, cy] of candidates) {
        const el = document.elementFromPoint(cx, cy);
        if (el?.closest('.react-flow__node')) return { cx, cy };
      }
      return null;
    }, { x: box.x, y: box.y, w: box.width, h: box.height });
  };
  let spot = await findSpot();
  if (!spot) {
    // pan the viewport down so the node clears the top bar
    const pane = page.locator('.react-flow__pane');
    const pb = (await pane.boundingBox())!;
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await page.mouse.down();
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2 + 160, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    spot = await findSpot();
  }
  if (spot) {
    await page.mouse.click(spot.cx, spot.cy, { button: 'right' });
    return;
  }
  // last resort: dispatch contextmenu straight to the node element — React
  // Flow's onNodeContextMenu receives it identically, occlusion be damned
  await node.dispatchEvent('contextmenu', { bubbles: true, cancelable: true });
}

/** Delete fixtures left by earlier suite runs (run-tags always start T<base36>).
 *  Keeps the shared dev store from accumulating test schemes/concepts/fields. */
export async function purgeTestResidue(page: Page) {
  const patterns = [
    // taxonomy fixtures: scheme-t..., top-t..., a-t..., concepts under them
    'DELETE WHERE { GRAPH ?g { ?s ?p ?o } . FILTER(REGEX(STR(?s), "taxonomy/(scheme-|top-|child-|a-|b-|old-|new-|parent|kid)t\\d", "i")) }',
    // custom fields minted by tests
    'DELETE { GRAPH ?g { ?s ?p ?o } } WHERE { GRAPH ?g { ?s ?p ?o } FILTER(REGEX(STR(?s), "prop/fieldt", "i")) }',
    'DELETE { GRAPH ?g { ?s ?p ?o } } WHERE { GRAPH ?g { ?s ?p ?o } FILTER(isIRI(?o) && REGEX(STR(?o), "vocab/fieldt", "i")) }',
  ];
  for (const q of patterns) {
    await page.evaluate(
      async (body) =>
        fetch('/db/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/sparql-update', 'X-Studio-User': 'pat' },
          body,
        }),
      q
    );
  }
}
