---
name: studio-verify
description: Verification playbook for Ontology Studio — build, unit tests, API smoke, and Playwright E2E patterns with the exact selectors that work. Use after any change, before any commit.
---

# Verification playbook

## Fast loop

```bash
cd C:/Users/Pat/git/ontology-studio
npm run build       # tsc -b && vite build — must be clean
npx vitest run      # ~100 tests: rdf layer, layout engine, server logic
```

Server changes additionally need `pm2 restart studio-server` + an API smoke.

## Playwright E2E (browser install lives in ek-kyc-demo/rag)

Write the script to `C:/Users/Pat/git/ek-kyc-demo/rag/<name>.mjs`, run with
`node <name>.mjs` from that directory, delete afterwards. Template:

```js
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5180/', { waitUntil: 'networkidle' });
await page.selectOption('.ep-select', { index: 1 });           // connect
await page.waitForSelector('.dot.ok', { timeout: 10000 });
await page.selectOption('.graph-select', 'https://studio.local/graphs/lineage');
await page.waitForFunction(() => document.querySelectorAll('.class-row').length >= 5);
```

Selector cheat sheet (stable):
- Tree: `.class-row` (+ `.twisty` to EXPAND — clicking the row center hits the
  name and selects instead), `.instance-list li`, `.count`
- Canvas: `.rdf-node`, `.rdf-node-label`, `.canvas-toolbar button` (Overview /
  Flow / Re-layout / Clear), `.canvas-toolbar select` (layout algo)
- Inspector: `.resource-title`, `.virtual-badge`, `.pred-cell`, `.shape-form .field-name`
- Agent: `.inspector .tab` (hasText 'Agent'), `.intent-chip`, `.agent-input`
- Drawer: `.drawer-head`, `.drawer-controls .tab` (SPARQL|SQL), `.sparql-input`, `.result-table td`
- Presence: `.presence` (remember: the user's own tab counts)
- Dev hook: `window.__studio` = `{ canvas, engine }` (zustand store + layout engine)

## API smoke

```bash
curl -s http://localhost:7881/api/health
curl -s -X POST http://localhost:7881/api/virtual/describe -H "Content-Type: application/json" \
  -d '{"iri":"https://studio.local/sql/sales_db#orders/1"}'   # expect placedBy -> Ada Lovelace
```

## Rules learned the hard way

- NEVER `git add -A` chained after fallible commands — a broken `&&` once ran it
  in the WRONG REPO (kalshi-suggestor). Always a dedicated Bash call:
  `cd <repo> && git add <explicit paths> && git commit`.
- Shell heredocs mangle `${...}` template literals — write patch scripts to the
  scratchpad with the Write tool and run `python file.py` instead.
- The graph must stay META-ONLY: any test asserting instance triples in
  Oxigraph is asserting a regression.

## Canvas click gotcha (hard-learned)
After Overview/fitView, several nodes sit off-screen or under the connection bar / toolbar overlays. `locator('.react-flow__node').nth(i).click()` then hits the overlay and selection silently fails. Always pick a hittable node first:
```js
const hittable = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('.react-flow__node').forEach((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    if (el.contains(document.elementFromPoint(cx, cy))) out.push({ cx, cy });
  });
  return out;
});
await page.mouse.click(hittable[0].cx, hittable[0].cy);
```
Selection keys: click = select, Shift+drag = box select, Ctrl+click = multi, Delete/Backspace = hide from canvas (view-only; graph deletion is context-menu only).

## Full regression sweep
`e2e/regression.mjs` covers the whole feature surface (omnibox, grid, canvas selection/PNG, taxonomy, saved queries, forms round 2, tree paging, GraphQL). Copy it into the playwright dir and run; exits non-zero on any FAIL.
