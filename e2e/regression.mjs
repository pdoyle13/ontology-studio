// Full-feature E2E regression sweep for Ontology Studio.
// Run from a playwright-equipped directory (see .claude/skills/studio-verify):
//   cp e2e/regression.mjs <playwright-dir>/ && cd <playwright-dir> && node regression.mjs
// Requires the dev stack up: studio-ui :5180, studio-server :7881, oxigraph.

import { chromium } from 'playwright';

const results = [];
const ok = (m) => results.push(`PASS ${m}`);
const fail = (m) => results.push(`FAIL ${m}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
let nextPrompt = '';
page.on('dialog', (d) => d.accept(nextPrompt));

async function connect() {
  await page.goto('http://localhost:5180');
  await page.waitForSelector('select', { timeout: 15000 });
  await page.selectOption('select', { label: 'Local Oxigraph (studio)' });
  await page.waitForSelector('.class-list li', { timeout: 15000 });
}

try {
  await connect();
  ok('connect + class tree');

  // ---- omnibox: model + live data ----
  await page.keyboard.press('Control+k');
  await page.fill('.omnibox-input', 'turing');
  await page.waitForSelector('.omnibox-hit', { timeout: 8000 });
  const hits = await page.$$eval('.omnibox-hit', (els) => els.map((e) => e.textContent));
  hits.filter((h) => h.includes('Alan Turing')).length >= 2
    ? ok('omnibox finds live rows across databases')
    : fail(`omnibox hits: ${hits.slice(0, 3)}`);
  await page.keyboard.press('Escape');

  // ---- data grid: sort + filter + SQL footer ----
  const ordRow = page.locator('.class-row', { hasText: 'Orders' }).first();
  await ordRow.locator('button[title="Browse live data (grid)"]').click();
  await page.waitForSelector('.data-grid .result-table tbody tr', { timeout: 10000 });
  const gridRows = await page.$$eval('.data-grid tbody tr', (els) => els.length);
  gridRows === 50 ? ok('grid page 1 = 50 rows') : fail(`grid rows ${gridRows}`);
  const statusHead = page.locator('.data-grid th.sortable', { hasText: 'Status' }).first();
  await statusHead.click();
  await page.waitForFunction(() => document.querySelector('.grid-sql')?.textContent.includes('ORDER BY'), { timeout: 8000 });
  ok('grid sort issues ORDER BY SQL');
  await page.click('.data-grid button:has-text("Close")');

  // ---- canvas: overview, select, delete-key, box select, PNG ----
  await page.click('button:has-text("Overview")');
  await page.waitForSelector('.rdf-node', { timeout: 15000 });
  await page.waitForTimeout(700);
  const hittable = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.react-flow__node').forEach((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      if (el.contains(document.elementFromPoint(cx, cy))) out.push({ cx, cy });
    });
    return out;
  });
  const n0 = await page.evaluate(() => window.__studio.canvas.getState().nodes.length);
  await page.mouse.click(hittable[0].cx, hittable[0].cy);
  await page.waitForTimeout(250);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(350);
  const n1 = await page.evaluate(() => window.__studio.canvas.getState().nodes.length);
  n1 === n0 - 1 ? ok('delete key hides node') : fail(`delete ${n0}->${n1}`);
  await page.keyboard.down('Shift');
  await page.mouse.move(420, 260);
  await page.mouse.down();
  await page.mouse.move(1250, 780, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(350);
  const sel = await page.evaluate(() => window.__studio.canvas.getState().nodes.filter((n) => n.selected).length);
  sel >= 2 ? ok(`box select (${sel})`) : fail(`box select ${sel}`);
  const dl = page.waitForEvent('download', { timeout: 20000 });
  await page.click('button:has-text("PNG")');
  (await (await dl).suggestedFilename()) === 'ontology-canvas.png' ? ok('PNG export') : fail('PNG name');

  // ---- taxonomy: tree renders the marathon's scheme ----
  await page.click('button.tab:has-text("Taxonomy")');
  await page.waitForSelector('.taxonomy-panel', { timeout: 8000 });
  await page.waitForSelector('.skos-row', { timeout: 8000 });
  const skosRows = await page.$$eval('.skos-row', (els) => els.map((e) => e.textContent));
  skosRows.length >= 3 ? ok(`taxonomy tree (${skosRows.length} concepts)`) : fail(`taxonomy rows ${skosRows.length}`);

  // ---- saved queries: save, reload, delete ----
  await page.click('.drawer-head');
  await page.waitForSelector('.sparql-input', { timeout: 5000 });
  await page.fill('.sparql-input', 'SELECT ?c WHERE { ?c a <http://www.w3.org/2004/02/skos/core#Concept> } LIMIT 5');
  nextPrompt = 'Regression sweep query';
  await page.click('button:has-text("Save")');
  await page.waitForFunction(
    () => [...document.querySelectorAll('.saved-picker option')].some((o) => o.textContent.includes('Regression sweep')),
    { timeout: 8000 }
  );
  ok('saved query persists');
  await page.selectOption('.saved-picker', { label: 'Regression sweep query (sparql)' });
  await page.click('button[title="Delete this saved query"]');
  await page.waitForFunction(
    () => ![...document.querySelectorAll('.saved-picker option')].some((o) => o.textContent.includes('Regression sweep')),
    { timeout: 8000 }
  );
  ok('saved query delete');
  await page.click('.drawer-head');

  // ---- forms round 2: help text + lang chip on the Poet fixture ----
  await page.keyboard.press('Control+k');
  await page.fill('.omnibox-input', 'rilke');
  await page.waitForSelector('.omnibox-hit', { timeout: 8000 });
  await page.keyboard.press('Enter');
  await page.waitForSelector('.shape-form', { timeout: 10000 });
  const helpCount = await page.locator('.field-help').count();
  const chip = await page.locator('.lang-chip').count();
  helpCount >= 2 ? ok('sh:description help lines') : fail(`helps ${helpCount}`);
  chip >= 1 ? ok('@lang chip renders') : fail('no lang chip');

  // ---- tree pagination ----
  await page.click('button.tab:has-text("Classes")');
  const dRow = page.locator('.class-row', { hasText: 'Delivery Events' }).first();
  await dRow.locator('.twisty').click();
  await page.waitForSelector('.instance-list li', { timeout: 20000 });
  await page.waitForTimeout(400);
  const more = await page.locator('.instance-list button.micro', { hasText: 'more' }).count();
  more === 1 ? ok('tree pagination footer') : fail(`more btns ${more}`);

  // ---- GraphQL endpoint ----
  const gql = await page.evaluate(async () => {
    const r = await fetch('/api/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ orders(limit: 1) { orderNumber } customers(limit: 1) { name } }' }),
    }).then((x) => x.json());
    return r.data;
  });
  gql?.orders?.[0]?.orderNumber && gql?.customers?.[0]?.name
    ? ok('GraphQL cross-source query')
    : fail(`graphql: ${JSON.stringify(gql)}`);
} catch (e) {
  fail(`exception: ${e.message.split('\n')[0]}`);
} finally {
  console.log(results.join('\n'));
  const bad = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - bad}/${results.length} passed`);
  await browser.close();
  process.exit(bad ? 1 : 0);
}
