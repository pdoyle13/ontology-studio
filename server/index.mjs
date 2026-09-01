// Ontology Studio sidecar (port 7881):
//  - SQL datasources: attach SQLite files, introspect schema, translate the
//    schema to an RDF ontology + SHACL shapes (Direct-Mapping style), and
//    keep everything virtual (meta-only graph). Read-only SQL query endpoint.
//  - Agent: Claude-powered modeling copilot with SPARQL tools (see agent.mjs).
// Requires: node --experimental-sqlite

import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, resolve as resolvePath } from 'node:path';
import { runAgent, agentAvailable } from './agent/agent.mjs';
import { QueryCache, DiskCache, TieredCache } from './core/cache.mjs';
import { emitR2rml, MAPPINGS_GRAPH, STUDIO } from './semantic/r2rml.mjs';
import { createDriver, safeDescriptor, connectorKinds } from './drivers.mjs';
import { readCatalog, planSources, queryClass } from './semantic/federation.mjs';
import { createGraphQL } from './semantic/graphqlLayer.mjs';
import { createSearchService } from './search/searchService.mjs';
import { readRules, materialize, explain, INFERRED_GRAPH } from './semantic/rules.mjs';
import { metaStore } from './core/meta.mjs';
import { assertInsideRoot } from './core/paths.mjs';
import { startPgFacade } from './bi/pgFacade.mjs';
import { readWorkflow, getState, setState, availableTransitions, validateTransition, STATE_GRAPH } from './governance/lifecycle.mjs';
import { addComment, listComments, COMMENTS_GRAPH } from './governance/comments.mjs';
import { createTokenStore } from './governance/tokens.mjs';
import { createOidcVerifier } from './governance/oidc.mjs';
import { createRegistry } from './core/metrics.mjs';
import { updateGraphTags } from './core/sparqlAst.mjs';
import { suggestCrosswalk, acceptMapping, removeMapping, listMappings, CROSSWALKS_GRAPH } from './semantic/crosswalk.mjs';
import { autoTag } from './semantic/autotag.mjs';
import { manifest as reconcileManifest, reconcileBatch } from './search/reconcile.mjs';
import { runQualityChecks, persistSnapshot, readHistory, QUALITY_GRAPH } from './semantic/quality.mjs';
import { discoverBusinessAreas, readAlignment } from './semantic/discover.mjs';
import { virtualInstances, virtualDescribe, virtualSearch } from './semantic/virtual.mjs';
import { buildSpec } from './ops/openapi.mjs';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';
import { createSnapshotter } from './ops/graphAsCode.mjs';
import { publishChange, busStatus } from './ops/eventBus.mjs';
import { createBackupEngine } from './ops/backup.mjs';
import { recordChange, readChangelog } from './governance/changelog.mjs';
import {
  resolveUser,
  canWriteDirect,
  canPropose,
  canReview,
  upsertUser,
  loadUsers,
  invalidateGovernanceCache,
  createProposal,
  listProposals,
  getProposal,
  proposalDiff,
  stageIntoProposal,
  submitProposal,
  decideProposal,
  seedGovernance,
  migrateStagingGraphs,
} from './governance/governance.mjs';

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
const cache = new TieredCache({
  memory: new QueryCache({
    maxEntries: Number(process.env.CACHE_MAX ?? 500),
    ttlMs: Number(process.env.CACHE_TTL_MS ?? 60_000),
  }),
  disk: process.env.DISK_CACHE === '0'
    ? null
    : new DiskCache({
        dir: join(__dirname, '.cache'),
        ttlMs: Number(process.env.DISK_CACHE_TTL_MS ?? 600_000),
        maxEntries: Number(process.env.DISK_CACHE_MAX ?? 2000),
      }),
});
// short-TTL federated SQL result cache, tagged per source
const sqlCache = new QueryCache({
  maxEntries: Number(process.env.SQL_CACHE_MAX ?? 300),
  ttlMs: Number(process.env.SQL_CACHE_TTL_MS ?? 15_000),
});

/** Which graph tags does a SPARQL update body touch? Empty → unknown → global.
 *  Parsed via Traqula (regex fallback inside) — governance write-gating and
 *  cache invalidation both key off this, so it must not miss graphs. */
const updateTags = (body) => updateGraphTags(body);

// ---------------- metrics ----------------
const metrics = createRegistry();
app.use(metrics.httpMiddleware());
metrics.startStatsd(); // no-op unless DD_AGENT_HOST is set
app.get('/metrics', (_req, res) => res.type('text/plain').send(metrics.promText()));

// ---------------- identity ----------------
// Resolution order: Bearer API token → OIDC JWT (when configured) →
// X-Studio-User header. AUTH_REQUIRED=1 turns the header path off for
// everything except reads, closing the honor-system gap for deployment.
//
// CSRF (P1.8): auth is header-based (Authorization / X-Studio-User), never a
// cookie, so a browser will not attach credentials to a cross-site request —
// there is no ambient authority to forge. If cookie/session auth is ever added,
// a CSRF token (or SameSite=strict + origin check) becomes mandatory here.
const tokenStore = createTokenStore(process.env.TOKENS_FILE ?? new URL('./.state/tokens.json', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const oidc = createOidcVerifier();

app.use(async (req, res, next) => {
  let name = null;
  let via = 'header';
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
  if (bearer) {
    const tokenUser = tokenStore.verify(bearer);
    if (tokenUser) {
      name = tokenUser;
      via = 'token';
    } else if (oidc) {
      try {
        name = (await oidc.verify(bearer)).subject;
        via = 'oidc';
      } catch {
        metrics.inc('auth_failures_total', { via: 'bearer' });
        return res.status(401).json({ error: 'invalid bearer credential' });
      }
    } else {
      metrics.inc('auth_failures_total', { via: 'token' });
      return res.status(401).json({ error: 'invalid API token' });
    }
  }
  if (!name) {
    if (process.env.AUTH_REQUIRED === '1' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      metrics.inc('auth_failures_total', { via: 'header' });
      return res.status(401).json({ error: 'authentication required (Bearer token or OIDC JWT)' });
    }
    name = req.headers['x-studio-user'] || 'pat';
  }
  try {
    req.studioUser = await resolveUser(OXIGRAPH, name);
  } catch {
    req.studioUser = { name, role: via === 'header' ? 'admin' : 'viewer', governs: [] };
  }
  req.authVia = via;
  next();
});


const forbid = (res, user, need) =>
  res.status(403).json({
    error: `'${user.name}' (${user.role}) may not do this — ${need}`,
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
    res.status(hit.entry.status).set('Content-Type', hit.entry.contentType)
      .set('X-Cache', hit.tier === 'mem' ? 'HIT-MEM' : 'HIT-DISK').send(hit.entry.body);
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
    if (up.ok) {
      // scope: named-graph queries depend only on that graph; unscoped depend on everything
      const g = /[?&]default-graph-uri=([^&]+)/.exec(url)?.[1];
      cache.set(cacheUrl, body, { status: up.status, contentType, body: text }, g ? [decodeURIComponent(g)] : ['*']);
    }
    res.status(up.status).set('Content-Type', contentType).set('X-Cache', 'MISS').send(text);
  } catch (e) {
    bad(res, 502, `oxigraph unreachable: ${e.message}`);
  }
});

app.post('/db/update', async (req, res) => {
  try {
    const body = typeof req.body === 'string' ? req.body : '';
    const tags = updateTags(body);
    const user = req.studioUser;
    // proposal mode: stage instead of applying
    const proposalId = req.headers['x-studio-proposal'];
    if (proposalId) {
      if (!canPropose(user)) return forbid(res, user, 'proposing requires editor, steward, or admin');
      const r = await stageIntoProposal(OXIGRAPH, String(proposalId), body);
      recordChange(OXIGRAPH, { actor: user.name, operation: `propose:${r.staged}`, graphs: tags, detail: body });
      return res.status(204).end();
    }
    if (!canWriteDirect(user, tags)) {
      return forbid(res, user, 'direct writes need admin, or steward of every targeted graph — create a proposal instead');
    }
    const up = await fetch(`${OXIGRAPH}/update`, {
      method: 'POST',
      headers: { 'Content-Type': req.headers['content-type'] ?? 'application/sparql-update' },
      body,
    });
    recordChange(OXIGRAPH, { actor: user.name, operation: 'sparql-update', graphs: tags, detail: body });
    publishChange({ actor: user.name, operation: 'sparql-update', graphs: tags, replay: { kind: 'sparql-update', body } });
    cache.invalidate(tags.length ? tags : undefined); // scoped when the update names graphs
    res.status(up.status).send(await up.text());
  } catch (e) {
    bad(res, 502, `oxigraph unreachable: ${e.message}`);
  }
});

app.all(/^\/db\/store/, async (req, res) => {
  const url = `${OXIGRAPH}/store${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
  if (!['GET', 'HEAD'].includes(req.method)) {
    const g = /[?&]graph=([^&]+)/.exec(url)?.[1];
    if (!canWriteDirect(req.studioUser, g ? [decodeURIComponent(g)] : [])) {
      return forbid(res, req.studioUser, 'bulk load/drop needs admin, or steward of the target graph');
    }
  }
  try {
    const up = await fetch(url, {
      method: req.method,
      headers: req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {},
      body: ['GET', 'HEAD', 'DELETE'].includes(req.method) ? undefined : (typeof req.body === 'string' ? req.body : ''),
    });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const g = /[?&]graph=([^&]+)/.exec(url)?.[1];
      const graphs = g ? [decodeURIComponent(g)] : [];
      recordChange(OXIGRAPH, { actor: req.studioUser?.name, operation: `store-${req.method.toLowerCase()}`, graphs });
      publishChange({
        actor: req.studioUser?.name,
        operation: `store-${req.method.toLowerCase()}`,
        graphs,
        replay: {
          kind: `store-${req.method.toLowerCase()}`,
          graph: graphs[0] ?? null,
          contentType: req.headers['content-type'] ?? 'application/n-triples',
          body: ['POST', 'PUT'].includes(req.method) ? (typeof req.body === 'string' ? req.body : '') : undefined,
        },
      });
      cache.invalidate(g ? graphs : undefined);
    }
    const text = await up.text();
    res.status(up.status).set('Content-Type', up.headers.get('content-type') ?? 'text/plain').send(text);
  } catch (e) {
    bad(res, 502, `oxigraph unreachable: ${e.message}`);
  }
});

app.get('/api/cache/stats', (_req, res) => res.json({ ...cache.stats(), sql: sqlCache.stats() }));
app.post('/api/cache/clear', (_req, res) => {
  cache.invalidate();
  sqlCache.invalidate();
  res.json({ ok: true });
});

app.use(express.json({ limit: '5mb' }));

// ---------------- token management (admin only) ----------------
app.get('/api/auth/tokens', (req, res) => {
  if (req.studioUser.role !== 'admin') return forbid(res, req.studioUser, 'token management is admin-only');
  res.json(tokenStore.list());
});
app.post('/api/auth/tokens', (req, res) => {
  if (req.studioUser.role !== 'admin') return forbid(res, req.studioUser, 'token management is admin-only');
  const { user, label } = req.body ?? {};
  if (!user) return bad(res, 400, 'user required');
  res.json(tokenStore.create(String(user), String(label ?? '')));
});
app.delete('/api/auth/tokens/:id', (req, res) => {
  if (req.studioUser.role !== 'admin') return forbid(res, req.studioUser, 'token management is admin-only');
  res.json({ revoked: tokenStore.revoke(req.params.id) });
});


// ---------------- sources registry (driver-backed) ----------------
/** @type {Map<string, ReturnType<typeof createDriver>>} */
const sources = new Map();

// SECURITY (P1.5): file-backed connectors must stay inside DATA_ROOT (default:
// the repo root, which holds seed/*.db). Set DATA_ROOT to relocate.
const DATA_ROOT = process.env.DATA_ROOT ? resolvePath(process.env.DATA_ROOT) : join(__dirname, '..');
const FILE_KINDS = new Set(['sqlite', 'duckdb']);

function attach({ kind = 'sqlite', target, id }) {
  const confinedTarget = FILE_KINDS.has(kind) ? assertInsideRoot(DATA_ROOT, target, `${kind} file`) : target;
  const sid =
    id ??
    (kind === 'sqlite'
      ? basename(target).replace(/\.[^.]*$/, '').replace(/[^\w-]/g, '_')
      : (() => { try { return new URL(target).pathname.replace(/^\//, '').replace(/[^\w-]/g, '_') || 'pg'; } catch { return 'pg'; } })());
  const driver = createDriver({ id: sid, kind, target: confinedTarget });
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
import { sqlTypeToXsd, classIri, propIri, translateSchema, isReadOnlySql } from './semantic/translate.mjs';

async function loadNTriples(nt, graph) {
  const url = graph ? `${OXIGRAPH}/store?graph=${encodeURIComponent(graph)}` : `${OXIGRAPH}/store?default`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/n-triples' }, body: nt });
  if (!res.ok) throw new Error(`Oxigraph load failed: ${res.status} ${await res.text().catch(() => '')}`);
  publishChange({ actor: 'system', operation: 'load-ntriples', graphs: [graph].filter(Boolean), replay: { kind: 'store-post', graph: graph ?? null, contentType: 'application/n-triples', body: nt } });
}

// ---------------- routes ----------------
app.get('/api/sql/kinds', (_req, res) => res.json(connectorKinds()));

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
  // SECURITY (P1.5): attaching a source can read arbitrary files / reach
  // internal hosts — admin only, and file paths are confined in attach().
  if (req.studioUser?.role !== 'admin') return forbid(res, req.studioUser, 'attaching data sources is admin-only');
  const { path, url, target: rawTarget, kind = 'sqlite', id } = req.body ?? {};
  const target = rawTarget ?? (kind === 'postgres' ? url : path) ?? path ?? url;
  if (!target) return bad(res, 400, 'target required (file path for sqlite, connection URL for postgres)');
  try {
    // existence check runs on the confined path so it can't probe outside DATA_ROOT
    const s = attach({ kind, target, id });
    if (kind === 'sqlite' && !existsSync(s.target)) { s.close?.(); sources.delete(s.id); return bad(res, 404, 'file not found'); }
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

/** Translate one source's schema into the meta layer (shared by route + agent tool). */
async function doTranslate(s, graph, namespace, tables = null) {
  const ns = (namespace || `https://studio.local/sql/${s.id}#`).trim();
  // tables: optional subset for selective onboarding of large databases
  let schema = await s.introspect();
  if (Array.isArray(tables) && tables.length) {
    const want = new Set(tables);
    schema = schema.filter((t) => want.has(t.name));
  }
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
  return {
    ok: true,
    namespace: ns,
    tables: schema.length,
    triples: nt.split('\n').filter(Boolean).length,
    mappingsGraph: MAPPINGS_GRAPH,
    mappingTriples: r2rml.split('\n').filter(Boolean).length,
  };
}

app.post('/api/sql/sources/:id/translate', async (req, res) => {
  const s = sources.get(req.params.id);
  if (!s) return bad(res, 404, 'no such source');
  const { graph, namespace } = req.body ?? {};
  try {
    res.json(await doTranslate(s, graph, namespace, req.body?.tables ?? null));
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

// ---------------- federation (KG-planned data access) ----------------
// The catalog derives from the mappings graph — memoized until any write
// invalidates the cache (translate/materialize/update all do) or sources change.
let catalogMemo = null;
cache.onInvalidate(() => { catalogMemo = null; });

async function cachedCatalog() {
  const key = [...sources.keys()].sort().join(',');
  if (catalogMemo?.key === key && Date.now() - catalogMemo.at < 300_000) return catalogMemo.value;
  const value = await readCatalog(OXIGRAPH, new Set(sources.keys()));
  // enrich with FIBO business alignment when discovery has run
  try {
    const alignment = await readAlignment(OXIGRAPH);
    for (const entry of value) {
      const cls = alignment.get(entry.classIri);
      if (cls) {
        entry.businessConcept = cls.conceptLabel;
        entry.businessArea = cls.area;
      }
      for (const col of entry.columns) {
        const a = alignment.get(col.property);
        if (a) {
          col.businessConcept = a.conceptLabel;
          col.businessArea = a.area;
        }
      }
    }
  } catch { /* no alignment yet */ }
  catalogMemo = { key, value, at: Date.now() };
  return value;
}

const federation = {
  readCatalog: cachedCatalog,
  queryClass: async (args) => {
    const catalog = await cachedCatalog();
    // short-TTL SQL result cache, tagged by owning source
    const key = JSON.stringify([args.classIri, args.columns ?? null, args.filters ?? null, args.limit ?? null, args.orderBy ?? null, args.offset ?? null]);
    const hit = sqlCache.get('fed', key);
    if (hit) return JSON.parse(hit.body);
    const result = await queryClass({ oxigraph: OXIGRAPH, drivers: sources, catalog, ...args });
    sqlCache.set('fed', key, { status: 200, contentType: 'application/json', body: JSON.stringify(result) }, [result.source.id]);
    return result;
  },
  discover: async () => {
    const catalog = await readCatalog(OXIGRAPH, new Set(sources.keys()));
    const result = await discoverBusinessAreas({ oxigraph: OXIGRAPH, catalog });
    cache.invalidate(); // alignment graph changed → catalog memo + query cache refresh
    return result;
  },
  addSource: async ({ kind, target, id }) => {
    if (!target) throw new Error('target required');
    if (kind === 'sqlite' && !existsSync(target)) throw new Error(`file not found: ${target}`);
    const s = attach({ kind, target, id });
    const tables = (await s.tables()).length; // probe now
    persist();
    cache.invalidate();
    return { id: s.id, kind: s.kind, tables };
  },
  translateSource: async ({ sourceId, graph, namespace }) => {
    const s = sources.get(sourceId);
    if (!s) throw new Error(`no such source: ${sourceId} (attached: ${[...sources.keys()].join(', ')})`);
    return doTranslate(s, graph, namespace);
  },
};

// ---------------- virtual instance layer (meta-only graph; live SQL) ----------------
let rowCountsMemo = null;
async function rowCounts() {
  if (rowCountsMemo && Date.now() - rowCountsMemo.at < 60_000) return rowCountsMemo.value;
  const catalog = await cachedCatalog();
  const value = new Map();
  for (const sid of new Set(catalog.map((c) => c.sourceId))) {
    const driver = sources.get(sid);
    if (!driver) continue;
    try {
      for (const t of await driver.introspect()) {
        const entry = catalog.find((c) => c.sourceId === sid && c.table === t.name);
        if (entry) value.set(entry.classIri, t.rowCount);
      }
    } catch { /* unreachable source */ }
  }
  rowCountsMemo = { at: Date.now(), value };
  return value;
}
cache.onInvalidate(() => { rowCountsMemo = null; });

// ---- Search: embedded BM25 index over the whole estate, ES/OpenSearch wire-compatible ----
const searchSvc = createSearchService({ oxigraph: OXIGRAPH, federation, drivers: sources });
cache.onInvalidate(() => searchSvc.markDirty());

// ES/OpenSearch compatibility surface (point any ES client at <server>/es)
app.get('/es', (_req, res) =>
  res.json({
    name: 'ontology-studio',
    cluster_name: 'studio',
    version: { number: '8.13.0', distribution: 'opensearch', build_flavor: 'embedded' },
    tagline: 'The graph knows where everything lives',
  })
);
app.get('/es/_cat/indices', async (_req, res) => {
  await searchSvc.ensure();
  const s = searchSvc.stats();
  res.type('text/plain').send(`green open studio - 1 0 ${s.docs} 0 - -\n`);
});
app.post('/es/_refresh', async (_req, res) => {
  try {
    res.json({ ok: true, ...(await searchSvc.rebuild()) });
  } catch (e) {
    bad(res, 500, e.message);
  }
});
const esSearch = async (req, res) => {
  try {
    res.json(await searchSvc.search(req.body ?? {}));
  } catch (e) {
    bad(res, 500, e.message);
  }
};
app.post('/es/_search', esSearch);
app.post('/es/studio/_search', esSearch);
app.get('/es/studio/_search', async (req, res) => {
  try {
    const q = String(req.query.q ?? '');
    res.json(await searchSvc.search({ query: { multi_match: { query: q, fields: ['label^3', 'text'] } }, size: Number(req.query.size ?? 10) }));
  } catch (e) {
    bad(res, 500, e.message);
  }
});

// friendly wrapper used by the omnibox
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json({ hits: [], facets: {}, total: 0, stats: searchSvc.stats() });
  try {
    const out = await searchSvc.quick(q, {
      kind: req.query.kind ? String(req.query.kind) : null,
      sourceId: req.query.sourceId ? String(req.query.sourceId) : null,
    });
    res.json({ ...out, stats: searchSvc.stats() });
  } catch (e) {
    bad(res, 500, e.message);
  }
});

// search watches: notified over the WS bus when a rebuild finds new results
app.get('/api/search/watches', (_req, res) => res.json(searchSvc.listWatches()));
app.post('/api/search/watches', (req, res) => {
  const { query } = req.body ?? {};
  if (!query || String(query).trim().length < 2) return bad(res, 400, 'query required');
  const id = `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  res.json(searchSvc.addWatch({ id, query: String(query).trim(), user: req.studioUser?.name ?? 'anon' }));
});
app.delete('/api/search/watches/:id', (req, res) => {
  searchSvc.removeWatch(req.params.id);
  res.status(204).end();
});

// ---- W3C Reconciliation API (OpenRefine-compatible) ----
const reconcileHandler = async (req, res) => {
  try {
    let queries = req.body?.queries ?? req.query?.queries ?? null;
    if (typeof queries === 'string') queries = JSON.parse(queries);
    if (!queries) return res.json(reconcileManifest(`http://localhost:${PORT}`));
    res.json(await reconcileBatch(searchSvc, queries));
  } catch (e) {
    bad(res, 500, e.message);
  }
};
app.get('/api/reconcile', reconcileHandler);
app.post('/api/reconcile', express.urlencoded({ extended: true }), reconcileHandler);

// ---- auto-tagging: find taxonomy concepts mentioned in free text ----
app.post('/api/tag', async (req, res) => {
  const { text, scheme } = req.body ?? {};
  if (!text || typeof text !== 'string') return bad(res, 400, 'text (string) required');
  try {
    res.json(await autoTag(OXIGRAPH, { text, scheme: scheme || null }));
  } catch (e) {
    bad(res, 500, e.message);
  }
});

// ---- crosswalks: inter-vocabulary SKOS mappings with suggestions ----
app.get('/api/crosswalk/suggest', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return bad(res, 400, 'from and to scheme IRIs required');
  try {
    res.json(await suggestCrosswalk(OXIGRAPH, { fromScheme: String(from), toScheme: String(to) }));
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.get('/api/crosswalk', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return bad(res, 400, 'from and to scheme IRIs required');
  try {
    res.json(await listMappings(OXIGRAPH, { fromScheme: String(from), toScheme: String(to) }));
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.post('/api/crosswalk', async (req, res) => {
  const user = req.studioUser;
  if (!canPropose(user)) return forbid(res, user, 'accepting mappings requires editor, steward, or admin');
  const { from, to, relation } = req.body ?? {};
  if (!from || !to) return bad(res, 400, 'from and to concept IRIs required');
  try {
    const r = await acceptMapping(OXIGRAPH, { from, to, relation });
    recordChange(OXIGRAPH, { actor: user.name, operation: `crosswalk:${r.relation}`, graphs: [CROSSWALKS_GRAPH], detail: `${from} -> ${to}` });
    cache.invalidate([CROSSWALKS_GRAPH]);
    res.json(r);
  } catch (e) {
    bad(res, 400, e.message);
  }
});

app.delete('/api/crosswalk', async (req, res) => {
  const user = req.studioUser;
  if (!canPropose(user)) return forbid(res, user, 'removing mappings requires editor, steward, or admin');
  const { from, to, relation } = req.body ?? {};
  if (!from || !to || !relation) return bad(res, 400, 'from, to, relation required');
  try {
    const r = await removeMapping(OXIGRAPH, { from, to, relation });
    recordChange(OXIGRAPH, { actor: user.name, operation: 'crosswalk:remove', graphs: [CROSSWALKS_GRAPH], detail: `${from} -x- ${to}` });
    cache.invalidate([CROSSWALKS_GRAPH]);
    res.json(r);
  } catch (e) {
    bad(res, 400, e.message);
  }
});

// ---- data quality: rule sweeps with persisted history ----
app.post('/api/quality/run', async (req, res) => {
  const user = req.studioUser;
  if (!['steward', 'admin'].includes(user.role)) return forbid(res, user, 'quality runs need steward or admin');
  try {
    const results = await runQualityChecks(OXIGRAPH);
    const at = new Date().toISOString();
    await persistSnapshot(OXIGRAPH, results, at);
    recordChange(OXIGRAPH, { actor: user.name, operation: 'quality-run', graphs: [QUALITY_GRAPH], detail: JSON.stringify(results) });
    cache.invalidate([QUALITY_GRAPH]);
    res.json({ at, results });
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.get('/api/quality', async (_req, res) => {
  try {
    res.json({ checks: await runQualityChecks(OXIGRAPH), history: await readHistory(OXIGRAPH) });
  } catch (e) {
    bad(res, 500, e.message);
  }
});

// ---- lifecycle workflows + comments + entity history ----

app.get('/api/lifecycle', async (req, res) => {
  const iri = String(req.query.iri ?? '');
  if (!iri) return bad(res, 400, 'iri required');
  try {
    const wf = await readWorkflow(OXIGRAPH, req.query.assetType ? String(req.query.assetType) : null);
    const state = await getState(OXIGRAPH, iri);
    res.json({
      state: state ?? wf.initial,
      explicit: state !== null,
      transitions: availableTransitions(wf, state, req.studioUser.role),
    });
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.post('/api/lifecycle/transition', async (req, res) => {
  const { iri, to, assetType } = req.body ?? {};
  if (!iri || !to) return bad(res, 400, 'iri and to required');
  try {
    const wf = await readWorkflow(OXIGRAPH, assetType ?? null);
    const state = await getState(OXIGRAPH, iri);
    const err = validateTransition(wf, state, to, req.studioUser.role);
    if (err) return bad(res, err.status, err.error);
    await setState(OXIGRAPH, iri, to);
    recordChange(OXIGRAPH, { actor: req.studioUser.name, operation: `lifecycle:${state ?? wf.initial}->${to}`, graphs: [STATE_GRAPH], detail: iri });
    publishChange({ actor: req.studioUser.name, operation: 'lifecycle', graphs: [STATE_GRAPH], replay: { kind: 'lifecycle', iri, to } });
    cache.invalidate([STATE_GRAPH]);
    res.json({ iri, state: to });
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.get('/api/comments', async (req, res) => {
  const iri = String(req.query.iri ?? '');
  if (!iri) return bad(res, 400, 'iri required');
  try {
    res.json(await listComments(OXIGRAPH, iri));
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.post('/api/comments', async (req, res) => {
  const { iri, text } = req.body ?? {};
  if (!iri || !String(text ?? '').trim()) return bad(res, 400, 'iri and text required');
  try {
    const c = await addComment(OXIGRAPH, { on: iri, by: req.studioUser.name, text: String(text).trim(), at: new Date().toISOString() });
    recordChange(OXIGRAPH, { actor: req.studioUser.name, operation: 'comment', graphs: [COMMENTS_GRAPH], detail: iri });
    publishChange({ actor: req.studioUser.name, operation: 'comment', graphs: [COMMENTS_GRAPH], replay: { kind: 'comment', iri, text: c.text } });
    cache.invalidate([COMMENTS_GRAPH]);
    res.json(c);
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.get('/api/entity-history', async (req, res) => {
  const iri = String(req.query.iri ?? '');
  if (!iri) return bad(res, 400, 'iri required');
  try {
    const all = await readChangelog(OXIGRAPH, 500);
    res.json(all.filter((e) => (e.detail ?? '').includes(iri)).slice(0, 50));
  } catch (e) {
    bad(res, 500, e.message);
  }
});

// ---- SHACL-AF rules: materialization into the inferred graph ----
const rulesRawUpdate = async (body) => {
  await metaStore(OXIGRAPH).updateRaw(body);
};

app.get('/api/rules', async (_req, res) => {
  try {
    res.json(await readRules(OXIGRAPH));
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.post('/api/rules/materialize', async (req, res) => {
  const user = req.studioUser;
  if (!canWriteDirect(user, [INFERRED_GRAPH])) return forbid(res, user, 'materialization writes the inferred graph');
  try {
    const result = await materialize({ oxigraph: OXIGRAPH, rawUpdate: rulesRawUpdate });
    recordChange(OXIGRAPH, { actor: user.name, operation: 'rules-materialize', graphs: [INFERRED_GRAPH], detail: JSON.stringify(result) });
    publishChange({ actor: user.name, operation: 'rules-materialize', graphs: [INFERRED_GRAPH], replay: { kind: 'rules-materialize' } });
    cache.invalidate([INFERRED_GRAPH, '*']);
    res.json(result);
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.get('/api/rules/explain', async (req, res) => {
  const { s: subj, p: pred, o: obj, oIsIri } = req.query;
  if (!subj || !pred || obj === undefined) return bad(res, 400, 's, p, o required');
  try {
    res.json(await explain({ oxigraph: OXIGRAPH, s: String(subj), p: String(pred), o: String(obj), oIsIri: oIsIri !== 'false' }));
  } catch (e) {
    bad(res, 500, e.message);
  }
});

// ---- GraphQL from shapes: SHACL node shapes ARE the schema ----
let gqlMemo = null;
async function gqlInstance() {
  if (gqlMemo) return gqlMemo;
  gqlMemo = await createGraphQL({ oxigraph: OXIGRAPH, federation });
  return gqlMemo;
}
cache.onInvalidate(() => { gqlMemo = null; });

app.get('/api/graphql/sdl', async (_req, res) => {
  try {
    const g = await gqlInstance();
    res.type('text/plain').send(g.sdl);
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.post('/api/graphql', async (req, res) => {
  const { query, variables } = req.body ?? {};
  if (!query) return bad(res, 400, 'query required');
  try {
    const g = await gqlInstance();
    res.json(await g.execute(query, variables));
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.get('/api/virtual/classes', async (_req, res) => {
  try {
    const [catalog, counts] = await Promise.all([cachedCatalog(), rowCounts()]);
    res.json(
      catalog.map((c) => ({
        classIri: c.classIri,
        sourceId: c.sourceId,
        table: c.table,
        rowCount: counts.get(c.classIri) ?? 0,
        businessArea: c.businessArea ?? null,
      }))
    );
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.post('/api/virtual/instances', async (req, res) => {
  const { classIri, search, limit } = req.body ?? {};
  if (!classIri) return bad(res, 400, 'classIri required');
  try {
    const catalog = await cachedCatalog();
    const key = JSON.stringify(['vi', classIri, search ?? '', limit ?? 200]);
    const hit = sqlCache.get('virt', key);
    if (hit) return res.json(JSON.parse(hit.body));
    const rows = await virtualInstances({ oxigraph: OXIGRAPH, catalog, drivers: sources, classIri, search, limit });
    if (rows === null) return bad(res, 404, 'not a virtual class');
    const entry = catalog.find((c) => c.classIri === classIri);
    sqlCache.set('virt', key, { status: 200, contentType: 'application/json', body: JSON.stringify(rows) }, [entry?.sourceId ?? '*']);
    res.json(rows);
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.get('/api/virtual/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const catalog = await cachedCatalog();
    const key = JSON.stringify(['vs', q]);
    const hit = sqlCache.get('virt', key);
    if (hit) return res.json(JSON.parse(hit.body));
    const out = await virtualSearch({ oxigraph: OXIGRAPH, catalog, drivers: sources, text: q });
    sqlCache.set('virt', key, { status: 200, contentType: 'application/json', body: JSON.stringify(out) }, ['*']);
    res.json(out);
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.post('/api/virtual/describe', async (req, res) => {
  const { iri } = req.body ?? {};
  if (!iri) return bad(res, 400, 'iri required');
  try {
    const catalog = await cachedCatalog();
    const key = JSON.stringify(['vd', iri]);
    const hit = sqlCache.get('virt', key);
    if (hit) return res.json(JSON.parse(hit.body));
    const d = await virtualDescribe({ oxigraph: OXIGRAPH, catalog, drivers: sources, iri });
    if (d === null) return bad(res, 404, 'not a virtual resource');
    sqlCache.set('virt', key, { status: 200, contentType: 'application/json', body: JSON.stringify(d) }, [d.virtual?.sourceId ?? '*']);
    res.json(d);
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.post('/api/discover/business-areas', async (_req, res) => {
  try {
    res.json(await federation.discover());
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.get('/api/federate/catalog', async (_req, res) => {
  try {
    const catalog = await federation.readCatalog();
    res.json({ classes: catalog, sources: [...sources.values()].map((s) => ({ id: s.id, kind: s.kind })) });
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.post('/api/federate/plan', async (req, res) => {
  try {
    const catalog = await federation.readCatalog();
    res.json({ plan: planSources(catalog, req.body?.classes ?? []) });
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.post('/api/federate/query', async (req, res) => {
  const { classIri, columns, filters, limit, orderBy, offset } = req.body ?? {};
  if (!classIri) return bad(res, 400, 'classIri required');
  try {
    res.json(await federation.queryClass({ classIri, columns, filters, limit, orderBy, offset }));
  } catch (e) {
    bad(res, 400, e.message);
  }
});

// ---------------- governance: users, changelog, proposals ----------------
app.get('/api/governance/users', async (_req, res) => {
  try {
    res.json([...(await loadUsers(OXIGRAPH)).values()]);
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.post('/api/governance/users', async (req, res) => {
  if (req.studioUser.role !== 'admin') return forbid(res, req.studioUser, 'user management is admin-only');
  try {
    const u = await upsertUser(OXIGRAPH, req.body ?? {});
    recordChange(OXIGRAPH, { actor: req.studioUser.name, operation: 'governance:upsert-user', detail: `${u.name} → ${u.role}` });
    res.json(u);
  } catch (e) {
    bad(res, 400, e.message);
  }
});

app.get('/api/governance/changelog', async (req, res) => {
  try {
    res.json(await readChangelog(OXIGRAPH, Number(req.query.limit ?? 50)));
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.get('/api/proposals', async (_req, res) => {
  try {
    res.json(await listProposals(OXIGRAPH));
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.post('/api/proposals', async (req, res) => {
  const user = req.studioUser;
  if (!canPropose(user)) return forbid(res, user, 'proposing requires editor, steward, or admin');
  try {
    const p = await createProposal(OXIGRAPH, { author: user.name, ...req.body });
    recordChange(OXIGRAPH, { actor: user.name, operation: 'proposal:create', graphs: [p.targetGraph], detail: p.title });
    res.json(p);
  } catch (e) {
    bad(res, 400, e.message);
  }
});

app.get('/api/proposals/:id/diff', async (req, res) => {
  try {
    const p = await getProposal(OXIGRAPH, req.params.id);
    if (!p) return bad(res, 404, 'no such proposal');
    res.json({ proposal: p, ...(await proposalDiff(OXIGRAPH, req.params.id)) });
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.post('/api/proposals/:id/submit', async (req, res) => {
  const user = req.studioUser;
  try {
    const p = await getProposal(OXIGRAPH, req.params.id);
    if (!p) return bad(res, 404, 'no such proposal');
    if (p.author !== user.name && user.role !== 'admin') return forbid(res, user, 'only the author or an admin may submit');
    const r = await submitProposal(OXIGRAPH, req.params.id);
    recordChange(OXIGRAPH, { actor: user.name, operation: 'proposal:submit', graphs: [p.targetGraph], detail: p.title });
    res.json(r);
  } catch (e) {
    bad(res, 400, e.message);
  }
});

for (const decision of ['approve', 'reject']) {
  app.post(`/api/proposals/:id/${decision}`, async (req, res) => {
    const user = req.studioUser;
    try {
      const p = await getProposal(OXIGRAPH, req.params.id);
      if (!p) return bad(res, 404, 'no such proposal');
      if (!canReview(user, p.targetGraph)) {
        return forbid(res, user, `reviewing needs admin, or steward of <${p.targetGraph}>`);
      }
      const diffBefore = decision === 'approve' ? await proposalDiff(OXIGRAPH, req.params.id) : null;
      const r = await decideProposal(OXIGRAPH, req.params.id, {
        approve: decision === 'approve',
        reviewer: user.name,
        note: req.body?.note,
      });
      if (r.status === 'merged' && diffBefore) {
        const parts = [];
        if (diffBefore.dels.length) parts.push(`DELETE DATA { GRAPH <${p.targetGraph}> { ${diffBefore.dels.join('\n')} } }`);
        if (diffBefore.adds.length) parts.push(`INSERT DATA { GRAPH <${p.targetGraph}> { ${diffBefore.adds.join('\n')} } }`);
        if (parts.length) {
          publishChange({ actor: user.name, operation: 'proposal:merge', graphs: [p.targetGraph], replay: { kind: 'sparql-update', body: parts.join(' ; ') } });
        }
      }
      recordChange(OXIGRAPH, {
        actor: user.name,
        operation: `proposal:${r.status}`,
        graphs: [p.targetGraph],
        detail: `${p.title}${r.applied ? ` (+${r.applied.adds}/−${r.applied.dels})` : ''}`,
      });
      if (r.status === 'merged') cache.invalidate([p.targetGraph]);
      res.json(r);
    } catch (e) {
      bad(res, 400, e.message);
    }
  });
}

// ---------------- backup / point-in-time restore (checkpoint + Kafka journal) ----------------
const backups = createBackupEngine({ oxigraph: OXIGRAPH, repoDir: join(__dirname, '..') });

app.post('/api/backup/checkpoint', async (req, res) => {
  if (req.studioUser.role !== 'admin') return forbid(res, req.studioUser, 'checkpoints are admin-only');
  try {
    const m = await backups.checkpoint(req.body?.label ?? '');
    recordChange(OXIGRAPH, { actor: req.studioUser.name, operation: 'backup:checkpoint', detail: m.id });
    res.json(m);
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.get('/api/backup/checkpoints', (_req, res) => {
  try {
    res.json(backups.listCheckpoints());
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.post('/api/backup/restore', async (req, res) => {
  if (req.studioUser.role !== 'admin') return forbid(res, req.studioUser, 'restore is admin-only');
  const { checkpoint, until, confirm } = req.body ?? {};
  if (!confirm) return bad(res, 400, 'restore wipes and replaces ALL named graphs — pass confirm:true');
  if (!checkpoint) return bad(res, 400, 'checkpoint id required');
  try {
    const r = await backups.restore({ checkpointId: checkpoint, until });
    recordChange(OXIGRAPH, { actor: req.studioUser.name, operation: 'backup:restore', detail: `${checkpoint}${until ? ` until ${until}` : ''}` });
    invalidateGovernanceCache();
    cache.invalidate();
    res.json(r);
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.get('/api/backup/status', (_req, res) => res.json({ kafka: busStatus(), checkpoints: backups.listCheckpoints().length }));

// ---------------- agent ----------------
app.post('/api/agent', async (req, res) => {
  try {
    const { messages, graph } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) return bad(res, 400, 'messages required');
    const user = req.studioUser;
    const proposalId = req.body?.proposal ? String(req.body.proposal) : null;
    const writePolicy = {
      user: user.name,
      role: user.role,
      proposalId,
      canDirect: canWriteDirect(user, [graph || null].filter(Boolean)),
      stage: (updateBody) => stageIntoProposal(OXIGRAPH, proposalId, updateBody),
      journal: (updateBody) =>
        publishChange({ actor: `${user.name} (agent)`, operation: 'agent:update', graphs: [graph].filter(Boolean), replay: { kind: 'sparql-update', body: updateBody } }),
    };
    const result = await runAgent({
      messages,
      graph: graph || null,
      oxigraph: OXIGRAPH,
      federation,
      writePolicy,
      graphqlExec: async (q, vars) => (await gqlInstance()).execute(q, vars),
    });
    const wrote = result.trace?.some((t) => t.ok && !['get_schema_overview', 'get_resource', 'sparql_query', 'get_data_catalog', 'query_source_data'].includes(t.tool));
    if (wrote) {
      recordChange(OXIGRAPH, {
        actor: `${user.name} (agent)`,
        operation: proposalId ? `agent:propose:${proposalId}` : 'agent:write',
        graphs: [graph].filter(Boolean),
        detail: result.trace.filter((t) => t.ok).map((t) => t.tool).join(', '),
      });
      if (!proposalId) cache.invalidate();
    }
    res.json(result);
  } catch (e) {
    bad(res, 500, e.message);
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, sources: sources.size, agent: agentAvailable() }));

// ---------------- API documentation ----------------
app.get('/api/openapi.json', (_req, res) => res.json(buildSpec()));

const require_ = createRequire(import.meta.url);
try {
  const swaggerDist = require_('swagger-ui-dist').absolutePath();
  app.get('/api/docs', (_req, res) => {
    res.type('html').send(`<!doctype html><html><head><title>Ontology Studio API</title>
<link rel="stylesheet" href="/api/docs-assets/swagger-ui.css"><style>body{margin:0}</style></head>
<body><div id="ui"></div>
<script src="/api/docs-assets/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({url:'/api/openapi.json',dom_id:'#ui',deepLinking:true,defaultModelsExpandDepth:0})</script>
</body></html>`);
  });
  app.use('/api/docs-assets', express.static(swaggerDist));
} catch { /* swagger-ui-dist not installed — spec still served */ }

// Container mode: serve the built UI from dist/ (same origin as /db and /api).
if (process.env.SERVE_UI) {
  const dist = join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get(/^\/(?!api|db).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

// BI facade: stock Postgres drivers (Tableau/Power BI/psql) query business
// objects as tables. Opt-in via BI_PORT.
if (process.env.BI_PORT) {
  const biPort = Number(process.env.BI_PORT);
  startPgFacade({ port: biPort, federation, log: (m) => console.log(m) });
  console.log(`bi-facade (postgres wire) on :${biPort}`);
}

// SECURITY (P1.6): identity is honor-system by default (X-Studio-User header,
// defaulting to an admin). Binding all interfaces in that mode would let anyone
// on the network claim admin. So bind loopback unless auth is enforced, and
// refuse to expose a public interface without AUTH_REQUIRED.
const AUTH_ON = process.env.AUTH_REQUIRED === '1';
const HOST = process.env.HOST || (AUTH_ON ? '0.0.0.0' : '127.0.0.1');
const isPublicBind = HOST === '0.0.0.0' || HOST === '::';
if (isPublicBind && !AUTH_ON) {
  console.error(
    `refusing to bind ${HOST} without AUTH_REQUIRED=1: header-trust auth on a public interface lets anyone claim admin. ` +
      `Set AUTH_REQUIRED=1 (and configure tokens/OIDC), or bind 127.0.0.1.`
  );
  process.exit(1);
}
if (!AUTH_ON) {
  console.warn('⚠  header-trust auth (AUTH_REQUIRED unset): X-Studio-User is trusted; bound to 127.0.0.1 only. Do not expose this port.');
}

const httpServer = app.listen(PORT, HOST, () =>
  console.log(`studio-server on ${HOST}:${PORT} (oxigraph: ${OXIGRAPH})${process.env.SERVE_UI ? ' serving UI' : ''}`)
);

// ---------------- collaboration (WebSocket broadcast bus) ----------------
// Every write path already funnels through cache.invalidate — that signal,
// with its graph tags, is exactly what other clients need to stay in sync.
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

// meta-layer-as-code: snapshot named graphs to graph/*.nt + auto-commit on writes
const snapshotter = createSnapshotter({ oxigraph: OXIGRAPH, repoDir: join(__dirname, '..') });
cache.onInvalidate(() => snapshotter.schedule());

// seed default governance users on first boot (idempotent)
seedGovernance(OXIGRAPH, ['https://studio.local/graphs/lineage'])
  .then((seeded) => seeded && console.log('governance: seeded default users (pat/admin, sam/steward, quinn/editor)'))
  .catch(() => {});
// convert any legacy live staging graphs (draft leakage) to on-proposal literals
migrateStagingGraphs(OXIGRAPH)
  .then((n) => n && console.log(`governance: migrated ${n} legacy proposal staging graph(s)`))
  .catch(() => {});


function wsBroadcast(msg, except = null) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client !== except && client.readyState === 1) client.send(data);
  }
}

// watch hits ride the same bus as graph changes
searchSvc.setWatchListener((hit) => wsBroadcast({ type: 'search-watch', ...hit }));

// Presence is debounced: page reloads and short-lived sockets churn
// open/close in bursts, and broadcasting each one makes the count flicker.
let presenceTimer = null;
function schedulePresence() {
  if (presenceTimer) clearTimeout(presenceTimer);
  presenceTimer = setTimeout(() => {
    presenceTimer = null;
    wsBroadcast({ type: 'presence', count: wss.clients.size });
  }, 800);
}

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'presence', count: wss.clients.size }));
  schedulePresence();
  socket.on('close', schedulePresence);
  socket.on('message', (raw) => {
    // relay lightweight client events (e.g. selection) to other participants
    try {
      const msg = JSON.parse(String(raw));
      if (msg?.type === 'selection' && typeof msg.iri === 'string') {
        wsBroadcast({ type: 'peer-selection', iri: msg.iri.slice(0, 500) }, socket);
      }
    } catch { /* ignore malformed */ }
  });
});

cache.onInvalidate((tags) => wsBroadcast({ type: 'graph-changed', tags: tags ?? null }));
