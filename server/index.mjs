// Ontology Studio sidecar (port 7881):
//  - SQL datasources: attach SQLite files, introspect schema, translate the
//    schema to an RDF ontology + SHACL shapes (Direct-Mapping style), and
//    materialize rows into Oxigraph. Read-only SQL query endpoint.
//  - Agent: Claude-powered modeling copilot with SPARQL tools (see agent.mjs).
// Requires: node --experimental-sqlite

import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { runAgent, agentAvailable } from './agent.mjs';
import { QueryCache } from './cache.mjs';
import { emitR2rml, emitSyncProvenance, MAPPINGS_GRAPH, STUDIO } from './r2rml.mjs';
import { createDriver, safeDescriptor } from './drivers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// load .env from the project root (gitignored) — GROK_API_KEY etc.
try {
  for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env — fine */ }
const PORT = Number(process.env.STUDIO_SERVER_PORT ?? 7881);
const OXIGRAPH = (process.env.OXIGRAPH_URL ?? 'http://localhost:7880').replace(/\/+$/, '');
const SOURCES_FILE = join(__dirname, 'sources.json');

const app = express();
const cache = new QueryCache({
  maxEntries: Number(process.env.CACHE_MAX ?? 500),
  ttlMs: Number(process.env.CACHE_TTL_MS ?? 60_000),
});

// ---------------- caching SPARQL passthrough (/db → Oxigraph) ----------------
// All UI reads route through here; every write path invalidates the cache.
app.use('/db', express.text({ type: '*/*', limit: '100mb' }));

app.post('/db/query', async (req, res) => {
  const url = `${OXIGRAPH}/query${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
  const accept = req.headers.accept ?? 'application/sparql-results+json';
  const cacheUrl = `${url}${accept}`;
  const body = typeof req.body === 'string' ? req.body : '';
  const hit = cache.get(cacheUrl, body);
  if (hit) {
    res.status(hit.status).set('Content-Type', hit.contentType).set('X-Cache', 'HIT').send(hit.body);
    return;
  }
  try {
    const up = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': req.headers['content-type'] ?? 'application/sparql-query', Accept: accept },
      body,
    });
    const text = await up.text();
    const contentType = up.headers.get('content-type') ?? 'application/json';
    if (up.ok) cache.set(cacheUrl, body, { status: up.status, contentType, body: text });
    res.status(up.status).set('Content-Type', contentType).set('X-Cache', 'MISS').send(text);
  } catch (e) {
    bad(res, 502, `oxigraph unreachable: ${e.message}`);
  }
});

app.post('/db/update', async (req, res) => {
  try {
    const up = await fetch(`${OXIGRAPH}/update`, {
      method: 'POST',
      headers: { 'Content-Type': req.headers['content-type'] ?? 'application/sparql-update' },
      body: typeof req.body === 'string' ? req.body : '',
    });
    cache.invalidate();
    res.status(up.status).send(await up.text());
  } catch (e) {
    bad(res, 502, `oxigraph unreachable: ${e.message}`);
  }
});

app.all(/^\/db\/store/, async (req, res) => {
  const url = `${OXIGRAPH}/store${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
  try {
    const up = await fetch(url, {
      method: req.method,
      headers: req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {},
      body: ['GET', 'HEAD', 'DELETE'].includes(req.method) ? undefined : (typeof req.body === 'string' ? req.body : ''),
    });
    if (req.method !== 'GET' && req.method !== 'HEAD') cache.invalidate();
    const text = await up.text();
    res.status(up.status).set('Content-Type', up.headers.get('content-type') ?? 'text/plain').send(text);
  } catch (e) {
    bad(res, 502, `oxigraph unreachable: ${e.message}`);
  }
});

app.get('/api/cache/stats', (_req, res) => res.json(cache.stats()));
app.post('/api/cache/clear', (_req, res) => {
  cache.invalidate();
  res.json({ ok: true });
});

app.use(express.json({ limit: '5mb' }));

// ---------------- sources registry (driver-backed) ----------------
/** @type {Map<string, ReturnType<typeof createDriver>>} */
const sources = new Map();

function attach({ kind = 'sqlite', target, id }) {
  const sid =
    id ??
    (kind === 'sqlite'
      ? basename(target).replace(/\.[^.]*$/, '').replace(/[^\w-]/g, '_')
      : (() => { try { return new URL(target).pathname.replace(/^\//, '').replace(/[^\w-]/g, '_') || 'pg'; } catch { return 'pg'; } })());
  const driver = createDriver({ id: sid, kind, target });
  sources.set(sid, driver);
  return driver;
}

function persist() {
  writeFileSync(
    SOURCES_FILE,
    JSON.stringify([...sources.values()].map((s) => ({ id: s.id, kind: s.kind, target: s.target })), null, 2)
  );
}

if (existsSync(SOURCES_FILE)) {
  try {
    for (const s of JSON.parse(readFileSync(SOURCES_FILE, 'utf8'))) {
      const target = s.target ?? s.path; // legacy field
      try { attach({ kind: s.kind ?? 'sqlite', target, id: s.id }); } catch (e) { console.warn(`skip source ${target}: ${e.message}`); }
    }
  } catch { /* fresh start */ }
}

const bad = (res, code, message) => res.status(code).json({ error: message });

// ---------------- RDF translation (pure logic in translate.mjs) ----------------
import { sqlTypeToXsd, classIri, propIri, translateSchema, rowsToBlocks, isReadOnlySql } from './translate.mjs';

async function loadNTriples(nt, graph) {
  const url = graph ? `${OXIGRAPH}/store?graph=${encodeURIComponent(graph)}` : `${OXIGRAPH}/store?default`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/n-triples' }, body: nt });
  if (!res.ok) throw new Error(`Oxigraph load failed: ${res.status} ${await res.text().catch(() => '')}`);
}

// ---------------- routes ----------------
app.get('/api/sql/sources', async (_req, res) => {
  const out = [];
  for (const s of sources.values()) {
    let tables = 0;
    try { tables = (await s.tables()).length; } catch { /* unreachable source */ }
    out.push({ id: s.id, kind: s.kind, target: safeDescriptor(s.kind, s.target), tables });
  }
  res.json(out);
});

app.post('/api/sql/sources', async (req, res) => {
  const { path, url, target: rawTarget, kind = 'sqlite', id } = req.body ?? {};
  const target = rawTarget ?? (kind === 'postgres' ? url : path) ?? path ?? url;
  if (!target) return bad(res, 400, 'target required (file path for sqlite, connection URL for postgres)');
  if (kind === 'sqlite' && !existsSync(target)) return bad(res, 404, `file not found: ${target}`);
  try {
    const s = attach({ kind, target, id });
    const tables = (await s.tables()).length; // probe the connection now
    persist();
    res.json({ id: s.id, kind: s.kind, target: safeDescriptor(s.kind, s.target), tables });
  } catch (e) {
    sources.delete(id ?? '');
    bad(res, 400, e.message);
  }
});

app.delete('/api/sql/sources/:id', (req, res) => {
  const s = sources.get(req.params.id);
  if (s) { s.close(); sources.delete(req.params.id); persist(); }
  res.json({ ok: true });
});

app.get('/api/sql/sources/:id/schema', async (req, res) => {
  const s = sources.get(req.params.id);
  if (!s) return bad(res, 404, 'no such source');
  try { res.json({ id: s.id, tables: await s.introspect() }); } catch (e) { bad(res, 500, e.message); }
});

app.post('/api/sql/sources/:id/translate', async (req, res) => {
  const s = sources.get(req.params.id);
  if (!s) return bad(res, 404, 'no such source');
  const { graph, namespace } = req.body ?? {};
  const ns = (namespace || `https://studio.local/sql/${s.id}#`).trim();
  try {
    const schema = await s.introspect();
    const nt = translateSchema(schema, ns);
    await loadNTriples(nt, graph || null);
    // the mapping itself is governed RDF: R2RML TriplesMaps in the mappings graph
    const r2rml = emitR2rml({
      sourceId: s.id,
      schema,
      ns,
      classIriFn: classIri,
      propIriFn: propIri,
      xsdFn: sqlTypeToXsd,
      nowIso: new Date().toISOString(),
    });
    await loadNTriples(r2rml, MAPPINGS_GRAPH);
    // source descriptor (credentials stripped) — the "which server does this live on" node
    const srcIri = `${STUDIO}source/${s.id.replace(/[^\w-]/g, '_')}`;
    await loadNTriples(
      [
        `<${srcIri}> <${STUDIO}kind> "${s.kind}" .`,
        `<${srcIri}> <${STUDIO}server> "${safeDescriptor(s.kind, s.target).replace(/\\/g, '/').replace(/"/g, '')}" .`,
      ].join('\n'),
      MAPPINGS_GRAPH
    );
    cache.invalidate();
    res.json({
      ok: true,
      namespace: ns,
      tables: schema.length,
      triples: nt.split('\n').filter(Boolean).length,
      mappingsGraph: MAPPINGS_GRAPH,
      mappingTriples: r2rml.split('\n').filter(Boolean).length,
    });
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.post('/api/sql/sources/:id/materialize', async (req, res) => {
  const s = sources.get(req.params.id);
  if (!s) return bad(res, 404, 'no such source');
  const { table, graph, namespace, limit } = req.body ?? {};
  if (!table) return bad(res, 400, 'table required');
  const ns = (namespace || `https://studio.local/sql/${s.id}#`).trim();
  const max = Number(limit) > 0 ? Number(limit) : Infinity;
  try {
    const info = (await s.introspect()).find((x) => x.name === table);
    if (!info) return bad(res, 404, `no such table: ${table}`);
    const sourceIri = `${STUDIO}source/${s.id.replace(/[^\w-]/g, '_')}`;
    const PAGE = 10000;
    let offset = 0;
    let rows = 0;
    let triples = 0;
    let batch = [];
    outer: for (;;) {
      const page = await s.page(table, PAGE, offset);
      if (page.length === 0) break;
      offset += page.length;
      for (const block of rowsToBlocks(page, info, ns, { sourceIri })) {
        batch.push(block);
        rows++;
        triples += block.split('\n').length;
        if (batch.length >= 2000) {
          await loadNTriples(batch.join('\n'), graph || null);
          batch = [];
        }
        if (rows >= max) break outer;
      }
    }
    if (batch.length) await loadNTriples(batch.join('\n'), graph || null);
    // queryable freshness metadata: prov:Activity in the mappings graph
    await loadNTriples(
      emitSyncProvenance({
        sourceId: s.id,
        table,
        dataGraph: graph || `${OXIGRAPH}/`,
        rows,
        triples,
        nowIso: new Date().toISOString(),
      }),
      MAPPINGS_GRAPH
    );
    cache.invalidate();
    res.json({ ok: true, table, rows, triples, namespace: ns });
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.post('/api/sql/sources/:id/query', async (req, res) => {
  const s = sources.get(req.params.id);
  if (!s) return bad(res, 404, 'no such source');
  const sql = String(req.body?.sql ?? '').trim();
  if (!isReadOnlySql(sql)) return bad(res, 400, 'read-only: SELECT/WITH/PRAGMA/EXPLAIN only');
  try {
    const rows = (await s.query(sql)).slice(0, 1000);
    const columns = rows.length ? Object.keys(rows[0]) : [];
    res.json({ columns, rows, truncated: rows.length === 1000 });
  } catch (e) {
    bad(res, 400, e.message);
  }
});

// ---------------- agent ----------------
app.post('/api/agent', async (req, res) => {
  try {
    const { messages, graph } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) return bad(res, 400, 'messages required');
    const result = await runAgent({ messages, graph: graph || null, oxigraph: OXIGRAPH });
    if (result.trace?.some((t) => t.tool === 'sparql_update' && t.ok)) cache.invalidate();
    res.json(result);
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, sources: sources.size, agent: agentAvailable() }));

// Container mode: serve the built UI from dist/ (same origin as /db and /api).
if (process.env.SERVE_UI) {
  const dist = join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get(/^\/(?!api|db).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`studio-server on :${PORT} (oxigraph: ${OXIGRAPH})${process.env.SERVE_UI ? ' serving UI' : ''}`));
