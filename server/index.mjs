// Ontology Studio sidecar (port 7881):
//  - SQL datasources: attach SQLite files, introspect schema, translate the
//    schema to an RDF ontology + SHACL shapes (Direct-Mapping style), and
//    materialize rows into Oxigraph. Read-only SQL query endpoint.
//  - Agent: Claude-powered modeling copilot with SPARQL tools (see agent.mjs).
// Requires: node --experimental-sqlite

import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { runAgent } from './agent.mjs';
import { QueryCache } from './cache.mjs';
import { emitR2rml, emitSyncProvenance, MAPPINGS_GRAPH } from './r2rml.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
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

// ---------------- sources registry ----------------
/** @type {Map<string, {id: string, path: string, db: import('node:sqlite').DatabaseSync}>} */
const sources = new Map();

function attach(path, id) {
  const db = new DatabaseSync(path, { readOnly: true });
  const sid = id ?? basename(path).replace(/\.[^.]*$/, '').replace(/[^\w-]/g, '_');
  sources.set(sid, { id: sid, path, db });
  return sources.get(sid);
}

function persist() {
  writeFileSync(SOURCES_FILE, JSON.stringify([...sources.values()].map((s) => ({ id: s.id, path: s.path })), null, 2));
}

if (existsSync(SOURCES_FILE)) {
  try {
    for (const s of JSON.parse(readFileSync(SOURCES_FILE, 'utf8'))) {
      try { attach(s.path, s.id); } catch (e) { console.warn(`skip source ${s.path}: ${e.message}`); }
    }
  } catch { /* fresh start */ }
}

const bad = (res, code, message) => res.status(code).json({ error: message });

// ---------------- schema introspection ----------------
function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
}

function introspect(db) {
  return tableNames(db).map((name) => {
    const columns = db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => ({
      name: c.name, type: String(c.type || 'TEXT').toUpperCase(), notnull: !!c.notnull, pk: !!c.pk,
    }));
    const fks = db.prepare(`PRAGMA foreign_key_list("${name}")`).all().map((f) => ({
      from: f.from, table: f.table, to: f.to,
    }));
    let rowCount = 0;
    try { rowCount = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n; } catch { /* virtual tables */ }
    return { name, rowCount, columns, fks };
  });
}

// ---------------- RDF translation (pure logic in translate.mjs) ----------------
import { sqlTypeToXsd, classIri, propIri, translateSchema, rowsToBlocks, isReadOnlySql } from './translate.mjs';

async function loadNTriples(nt, graph) {
  const url = graph ? `${OXIGRAPH}/store?graph=${encodeURIComponent(graph)}` : `${OXIGRAPH}/store?default`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/n-triples' }, body: nt });
  if (!res.ok) throw new Error(`Oxigraph load failed: ${res.status} ${await res.text().catch(() => '')}`);
}

// ---------------- row materialization ----------------
function* materializeRows(db, table, ns) {
  const info = introspect(db).find((x) => x.name === table);
  if (!info) throw new Error(`no such table: ${table}`);
  // paged reads — .iterate() finalizes if we await between rows
  const PAGE = 10000;
  let offset = 0;
  let page;
  const nextPage = () => db.prepare(`SELECT rowid AS __rowid, * FROM "${table}" LIMIT ${PAGE} OFFSET ${offset}`).all();
  while ((page = nextPage()).length > 0) {
    offset += page.length;
    yield* rowsToBlocks(page, info, ns);
  }
}

// ---------------- routes ----------------
app.get('/api/sql/sources', (_req, res) => {
  res.json([...sources.values()].map((s) => ({ id: s.id, path: s.path, tables: tableNames(s.db).length })));
});

app.post('/api/sql/sources', (req, res) => {
  const { path, id } = req.body ?? {};
  if (!path) return bad(res, 400, 'path required');
  if (!existsSync(path)) return bad(res, 404, `file not found: ${path}`);
  try {
    const s = attach(path, id);
    persist();
    res.json({ id: s.id, path: s.path, tables: tableNames(s.db).length });
  } catch (e) {
    bad(res, 400, e.message);
  }
});

app.delete('/api/sql/sources/:id', (req, res) => {
  const s = sources.get(req.params.id);
  if (s) { try { s.db.close(); } catch { /* already closed */ } sources.delete(req.params.id); persist(); }
  res.json({ ok: true });
});

app.get('/api/sql/sources/:id/schema', (req, res) => {
  const s = sources.get(req.params.id);
  if (!s) return bad(res, 404, 'no such source');
  try { res.json({ id: s.id, tables: introspect(s.db) }); } catch (e) { bad(res, 500, e.message); }
});

app.post('/api/sql/sources/:id/translate', async (req, res) => {
  const s = sources.get(req.params.id);
  if (!s) return bad(res, 404, 'no such source');
  const { graph, namespace } = req.body ?? {};
  const ns = (namespace || `https://studio.local/sql/${s.id}#`).trim();
  try {
    const schema = introspect(s.db);
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
    let batch = [];
    let rows = 0;
    let triples = 0;
    for (const block of materializeRows(s.db, table, ns)) {
      batch.push(block);
      rows++;
      triples += block.split('\n').length;
      if (batch.length >= 2000) {
        await loadNTriples(batch.join('\n'), graph || null);
        batch = [];
      }
      if (rows >= max) break;
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

app.post('/api/sql/sources/:id/query', (req, res) => {
  const s = sources.get(req.params.id);
  if (!s) return bad(res, 404, 'no such source');
  const sql = String(req.body?.sql ?? '').trim();
  if (!isReadOnlySql(sql)) return bad(res, 400, 'read-only: SELECT/WITH/PRAGMA/EXPLAIN only');
  try {
    const stmt = s.db.prepare(sql);
    const rows = stmt.all().slice(0, 1000);
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

app.get('/api/health', (_req, res) => res.json({ ok: true, sources: sources.size, agent: !!process.env.ANTHROPIC_API_KEY }));

app.listen(PORT, () => console.log(`studio-server on :${PORT} (oxigraph: ${OXIGRAPH})`));
