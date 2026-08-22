// SPARQL 1.1 protocol client. Works against any endpoint exposing query/update;
// Oxigraph additionally exposes a Graph Store endpoint (/store) for bulk load.

export interface Endpoint {
  id: string;
  name: string;
  queryUrl: string;
  updateUrl?: string;
  storeUrl?: string; // SPARQL Graph Store Protocol (Oxigraph: /store)
  defaultGraph?: string; // named graph IRI to scope edits to
}

export interface SelectBinding {
  [variable: string]: {
    type: 'uri' | 'literal' | 'bnode';
    value: string;
    'xml:lang'?: string;
    datatype?: string;
  };
}

export interface SelectResult {
  vars: string[];
  bindings: SelectBinding[];
}

export class SparqlError extends Error {
  status?: number;
  body?: string;
  constructor(message: string, status?: number, body?: string) {
    super(message);
    this.name = 'SparqlError';
    this.status = status;
    this.body = body;
  }
}

const TIMEOUT_MS = 30_000;

async function post(url: string, body: string, contentType: string, accept: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': contentType, Accept: accept },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new SparqlError(`${res.status} ${res.statusText}`, res.status, await res.text().catch(() => ''));
    }
    return res;
  } catch (e) {
    if (e instanceof SparqlError) throw e;
    if ((e as Error).name === 'AbortError') throw new SparqlError(`Request timed out after ${TIMEOUT_MS / 1000}s`);
    throw new SparqlError(`Network error: ${(e as Error).message}`);
  } finally {
    clearTimeout(t);
  }
}

/** SPARQL-protocol dataset spec: scope a query to a named graph, or (Oxigraph)
 *  to the union of all graphs. Used where the query text itself isn't already
 *  graph-scoped (the user-facing SPARQL drawer). */
export interface DatasetSpec {
  defaultGraph?: string;
  union?: boolean; // Oxigraph's union-default-graph
}

function buildQueryUrl(ep: Endpoint, dataset?: DatasetSpec): string {
  if (!dataset) return ep.queryUrl;
  const params = new URLSearchParams();
  if (dataset.defaultGraph) params.set('default-graph-uri', dataset.defaultGraph);
  else if (dataset.union && ep.storeUrl) params.set('union-default-graph', '');
  const qs = params.toString();
  return qs ? `${ep.queryUrl}${ep.queryUrl.includes('?') ? '&' : '?'}${qs}` : ep.queryUrl;
}

export async function select(ep: Endpoint, query: string, dataset?: DatasetSpec): Promise<SelectResult> {
  const res = await post(buildQueryUrl(ep, dataset), query, 'application/sparql-query', 'application/sparql-results+json');
  const json = await res.json();
  return { vars: json.head?.vars ?? [], bindings: json.results?.bindings ?? [] };
}

export async function ask(ep: Endpoint, query: string, dataset?: DatasetSpec): Promise<boolean> {
  const res = await post(buildQueryUrl(ep, dataset), query, 'application/sparql-query', 'application/sparql-results+json');
  const json = await res.json();
  return !!json.boolean;
}

/** CONSTRUCT / DESCRIBE — returns Turtle text (parse with n3 at the call site). */
export async function construct(ep: Endpoint, query: string, dataset?: DatasetSpec): Promise<string> {
  const res = await post(buildQueryUrl(ep, dataset), query, 'application/sparql-query', 'text/turtle');
  return res.text();
}

export async function update(ep: Endpoint, updateQuery: string): Promise<void> {
  if (!ep.updateUrl) throw new SparqlError('Endpoint has no update URL (read-only connection)');
  await post(ep.updateUrl, updateQuery, 'application/sparql-update', '*/*');
}

/** Bulk-load Turtle into a named graph via the Graph Store Protocol (POST = merge). */
export async function loadTurtle(ep: Endpoint, turtle: string, graph?: string): Promise<void> {
  if (!ep.storeUrl) throw new SparqlError('Endpoint has no Graph Store URL — bulk load unavailable');
  const url = graph
    ? `${ep.storeUrl}?graph=${encodeURIComponent(graph)}`
    : `${ep.storeUrl}?default`;
  await post(url, turtle, 'text/turtle', '*/*');
}

/** Quick connectivity probe. */
export async function testConnection(ep: Endpoint): Promise<{ ok: boolean; message: string }> {
  try {
    await ask(ep, 'ASK { }');
    return { ok: true, message: 'Connected' };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** List named graphs with triple counts. */
export async function listGraphs(ep: Endpoint): Promise<{ graph: string; triples: number }[]> {
  const r = await select(ep, 'SELECT ?g (COUNT(*) AS ?n) WHERE { GRAPH ?g { ?s ?p ?o } } GROUP BY ?g ORDER BY DESC(?n) LIMIT 100');
  return r.bindings.map((b) => ({ graph: b.g?.value ?? '', triples: Number(b.n?.value ?? 0) }));
}

export function oxigraphEndpoint(base: string, name = 'Oxigraph'): Endpoint {
  const b = base.replace(/\/+$/, '');
  return { id: b, name, queryUrl: `${b}/query`, updateUrl: `${b}/update`, storeUrl: `${b}/store` };
}
