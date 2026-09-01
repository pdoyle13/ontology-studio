// Graph-store abstraction: one interface over SPARQL 1.1 stores. Adapters
// encode each vendor's URL layout, union-default-graph mechanism, auth, and
// whether the Graph Store Protocol exists (Neptune has none — loads fall back
// to chunked INSERT DATA). Oxigraph stays the default and the only adapter
// exercised in CI; the others are written to each vendor's documented
// protocol and need live-endpoint validation.
//
// Config: GRAPH_STORE_KIND = oxigraph | graphdb | stardog | neptune
//         GRAPH_STORE_URL  = store base (see per-adapter notes below)
//         GRAPH_STORE_USER / GRAPH_STORE_PASSWORD = basic auth when needed

const ADAPTERS = {
    // url = http://host:7878 (root)
    oxigraph: {
        queryUrl: (base, union) => {
            const u = new URL(`${base}/query`);
            if (union) u.searchParams.set('union-default-graph', '');
            return u;
        },
        updateUrl: (base) => new URL(`${base}/update`),
        gspUrl: (base, graph) => {
            const u = new URL(`${base}/store`);
            if (graph) u.searchParams.set('graph', graph);
            return u;
        },
    },
    // url = http://host:7200/repositories/<repo>. GraphDB's default dataset
    // already unions named graphs, so union is a no-op; updates go to /statements.
    graphdb: {
        queryUrl: (base) => new URL(base),
        updateUrl: (base) => new URL(`${base}/statements`),
        gspUrl: (base, graph) => {
            const u = new URL(`${base}/rdf-graphs/service`);
            if (graph) u.searchParams.set('graph', graph);
            return u;
        },
    },
    // url = http://host:5820/<db>. Union via the special stardog context.
    stardog: {
        queryUrl: (base, union) => {
            const u = new URL(`${base}/query`);
            if (union) u.searchParams.set('default-graph-uri', 'tag:stardog:api:context:all');
            return u;
        },
        updateUrl: (base) => new URL(`${base}/update`),
        gspUrl: null, // use the INSERT fallback
    },
    // url = https://host:8182. One /sparql endpoint for query + update; the
    // default graph is already the union of all graphs; no GSP.
    neptune: {
        queryUrl: (base) => new URL(`${base}/sparql`),
        updateUrl: (base) => new URL(`${base}/sparql`),
        gspUrl: null,
    },
};

export function knownStoreKinds() {
    return Object.keys(ADAPTERS);
}

/** Pure: chunk N-Triples lines into INSERT DATA updates (GSP fallback). */
export function chunkInserts(ntLines, graph, chunkSize = 2000) {
    const out = [];
    for (let i = 0; i < ntLines.length; i += chunkSize) {
        const block = ntLines.slice(i, i + chunkSize).join('\n');
        out.push(graph ? `INSERT DATA { GRAPH <${graph}> { ${block} } }` : `INSERT DATA { ${block} }`);
    }
    return out;
}

export function createGraphStore({
    kind = process.env.GRAPH_STORE_KIND || 'oxigraph',
    url,
    user = process.env.GRAPH_STORE_USER,
    password = process.env.GRAPH_STORE_PASSWORD,
} = {}) {
    const adapter = ADAPTERS[kind];
    if (!adapter) throw new Error(`unknown graph store kind '${kind}' (known: ${knownStoreKinds().join(', ')})`);
    const base = (url ?? process.env.GRAPH_STORE_URL ?? process.env.OXIGRAPH_URL ?? 'http://localhost:7880').replace(
        /\/+$/,
        '',
    );

    const authHeaders = () =>
        user ? { Authorization: `Basic ${Buffer.from(`${user}:${password ?? ''}`).toString('base64')}` } : {};

    async function query(sparqlText, { union = true, accept = 'application/sparql-results+json' } = {}) {
        const res = await fetch(adapter.queryUrl(base, union), {
            method: 'POST',
            headers: { 'Content-Type': 'application/sparql-query', Accept: accept, ...authHeaders() },
            body: sparqlText,
        });
        if (!res.ok) throw new Error(`${kind} query ${res.status}`);
        return accept.includes('json') ? (await res.json()).results.bindings : res.text();
    }

    async function updateRaw(body, contentType = 'application/sparql-update') {
        const res = await fetch(adapter.updateUrl(base), {
            method: 'POST',
            headers: { 'Content-Type': contentType, ...authHeaders() },
            body,
        });
        if (!res.ok) throw new Error(`${kind} update ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return res;
    }

    /** Load N-Triples into a graph: GSP when available, chunked INSERTs otherwise. */
    async function loadNTriples(nt, graph) {
        if (adapter.gspUrl) {
            const res = await fetch(adapter.gspUrl(base, graph), {
                method: 'POST',
                headers: { 'Content-Type': 'application/n-triples', ...authHeaders() },
                body: nt,
            });
            if (!res.ok) throw new Error(`${kind} load ${res.status}`);
            return;
        }
        const lines = nt
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'));
        for (const u of chunkInserts(lines, graph)) await updateRaw(u);
    }

    return {
        kind,
        base,
        supportsGsp: !!adapter.gspUrl,
        queryUrl: (union = true) => adapter.queryUrl(base, union),
        updateUrl: () => adapter.updateUrl(base),
        gspUrl: adapter.gspUrl ? (graph) => adapter.gspUrl(base, graph) : null,
        authHeaders,
        query,
        updateRaw,
        loadNTriples,
    };
}
