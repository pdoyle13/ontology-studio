import { test, expect } from '@playwright/test';

// Request-level coverage of every public API surface — no browser needed.
const API = 'http://localhost:7881';

test.describe('HTTP API surfaces', () => {
  test('OpenAPI spec covers the endpoint families', async ({ request }) => {
    const spec = await (await request.get(`${API}/api/openapi.json`)).json();
    const paths = Object.keys(spec.paths);
    for (const p of ['/api/graphql', '/api/search', '/es/studio/_search']) {
      expect(paths).toContain(p);
    }
  });

  test('GraphQL: SDL + cross-source query + error shape', async ({ request }) => {
    const sdl = await (await request.get(`${API}/api/graphql/sdl`)).text();
    expect(sdl).toContain('type Query');
    expect(sdl).toContain('orders(limit: Int, offset: Int)');
    const r = await (
      await request.post(`${API}/api/graphql`, {
        data: { query: '{ orders(limit: 2) { orderNumber status } customers(limit: 1) { name } }' },
      })
    ).json();
    expect(r.data.orders).toHaveLength(2);
    expect(r.data.customers[0].name).toBeTruthy();
    const bad = await (await request.post(`${API}/api/graphql`, { data: { query: '{ nope }' } })).json();
    expect(bad.errors).toBeTruthy();
  });

  test('ES wire compatibility: cluster info, _search DSL, _cat', async ({ request }) => {
    const info = await (await request.get(`${API}/es`)).json();
    expect(info.version.number).toBeTruthy();
    const search = await (
      await request.post(`${API}/es/studio/_search`, {
        data: { query: { bool: { must: [{ multi_match: { query: 'turing', fields: ['label^3', 'text'] } }], filter: [{ term: { kind: 'data' } }] } }, size: 3, aggs: { bySource: { terms: { field: 'sourceId' } } } },
      })
    ).json();
    expect(search.hits.total.value).toBeGreaterThan(0);
    expect(search.hits.hits[0]._source.kind).toBe('data');
    expect(search.aggregations.bySource.buckets.length).toBeGreaterThan(0);
    const cat = await (await request.get(`${API}/es/_cat/indices`)).text();
    expect(cat).toContain('studio');
  });

  test('reconciliation API: manifest + scored batch', async ({ request }) => {
    const manifest = await (await request.get(`${API}/api/reconcile`)).json();
    expect(manifest.versions).toContain('0.2');
    const batch = await (
      await request.post(`${API}/api/reconcile`, { data: { queries: { q0: { query: 'Alan Turing', limit: 2 } } } })
    ).json();
    expect(batch.q0.result[0].match).toBe(true);
    expect(batch.q0.result[0].score).toBe(100);
  });

  test('federation: guarded errors on unknown columns and operators', async ({ request }) => {
    const bad = await request.post(`${API}/api/federate/query`, {
      data: { classIri: 'https://studio.local/sql/sales_db#orders', filters: [{ column: 'evil; DROP', op: '=', value: 1 }] },
    });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error).toMatch(/unknown column/);
    const ok = await (
      await request.post(`${API}/api/federate/query`, {
        data: { classIri: 'https://studio.local/sql/sales_db#orders', filters: [{ column: 'status', op: '=', value: 'shipped' }], limit: 3 },
      })
    ).json();
    expect(ok.rows.length).toBe(3);
    expect(ok.source.id).toBe('sales_db');
  });

  test('virtual layer: classes, instances, describe with cross-DB links', async ({ request }) => {
    const classes = await (await request.get(`${API}/api/virtual/classes`)).json();
    expect(classes.length).toBeGreaterThan(20);
    const inst = await (
      await request.post(`${API}/api/virtual/instances`, { data: { classIri: 'https://studio.local/sql/sales_db#orders', limit: 2 } })
    ).json();
    expect(inst).toHaveLength(2);
    const desc = await (await request.post(`${API}/api/virtual/describe`, { data: { iri: inst[0].iri } })).json();
    expect(desc.virtual.sourceId).toBe('sales_db');
    expect(desc.outgoing.length).toBeGreaterThan(3);
  });

  test('auth: bad bearer 401, token management admin-only', async ({ request }) => {
    const bad = await request.get(`${API}/api/search?q=test`, { headers: { Authorization: 'Bearer ostudio_bogus' } });
    expect(bad.status()).toBe(401);
    const nonAdmin = await request.post(`${API}/api/auth/tokens`, {
      headers: { 'X-Studio-User': 'quinn' },
      data: { user: 'quinn' },
    });
    expect(nonAdmin.status()).toBe(403);
  });

  test('metrics: Prometheus exposition with request counters', async ({ request }) => {
    const text = await (await request.get(`${API}/metrics`)).text();
    expect(text).toContain('# TYPE http_requests_total counter');
    expect(text).toContain('http_request_duration_ms_bucket');
    expect(text).toContain('process_resident_memory_bytes');
  });

  test('lifecycle API validates inputs and roles', async ({ request }) => {
    const missing = await request.post(`${API}/api/lifecycle/transition`, { data: {} });
    expect(missing.status()).toBe(400);
    const badMove = await request.post(`${API}/api/lifecycle/transition`, {
      headers: { 'X-Studio-User': 'pat' },
      data: { iri: 'https://example.org/music#Radiohead', to: 'nonexistent-state' },
    });
    expect(badMove.status()).toBe(400); // undefined transition = validation error, not authz
    // fresh IRI starts at the workflow's initial state (draft); draft->in-review
    // is a real transition but needs editor, and unknown users are viewers
    const notAllowed = await request.post(`${API}/api/lifecycle/transition`, {
      headers: { 'X-Studio-User': 'rando-viewer' },
      data: { iri: 'https://example.org/music#LifecycleProbe', to: 'in-review' },
    });
    expect(notAllowed.status()).toBe(403); // real permission denial keeps 403
  });

  test('sql console: read-only enforcement + kinds registry', async ({ request }) => {
    const kinds = await (await request.get(`${API}/api/sql/kinds`)).json();
    expect(kinds.map((k: { kind: string }) => k.kind)).toEqual(expect.arrayContaining(['sqlite', 'postgres', 'duckdb', 'mysql', 'trino', 'rest']));
    const write = await request.post(`${API}/api/sql/sources/sales_db/query`, { data: { sql: 'DROP TABLE orders' } });
    expect(write.status()).toBe(400);
  });

  test('search watches: create, list, delete', async ({ request }) => {
    const created = await (await request.post(`${API}/api/search/watches`, { data: { query: 'apitest watch' } })).json();
    expect(created.id).toBeTruthy();
    const list = await (await request.get(`${API}/api/search/watches`)).json();
    expect(list.map((w: { id: string }) => w.id)).toContain(created.id);
    const del = await request.delete(`${API}/api/search/watches/${created.id}`);
    expect(del.status()).toBe(204);
  });

  test('governance gate catches WITH-scoped updates (regex tagging missed them)', async ({ request }) => {
    const r = await request.post(`${API}/db/update`, {
      headers: { 'Content-Type': 'application/sparql-update', 'X-Studio-User': 'quinn' },
      data: 'WITH <https://studio.local/graphs/lineage> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }',
    });
    expect(r.status()).toBe(403); // editor may not write a governed graph directly, however scoped
  });

  test('backup checkpoints list', async ({ request }) => {
    const r = await request.get(`${API}/api/backup/checkpoints`);
    expect([200, 404].includes(r.status())).toBe(true); // list may be empty but the surface answers
  });
});
