// Shared meta-layer SPARQL access. All reads flow through the graph-store
// abstraction, so pointing GRAPH_STORE_KIND/GRAPH_STORE_URL at GraphDB,
// Stardog, or Neptune retargets every module (federation, virtual layer,
// discovery, search, rules) at once. The legacy first argument (the Oxigraph
// base URL) is kept for call-site compatibility and used as the store URL
// when no explicit GRAPH_STORE_URL is configured.

import { createGraphStore } from './graphStore.mjs';

let store = null;
let storeBase = null;

export function metaStore(base) {
    const wanted = process.env.GRAPH_STORE_URL ?? base;
    if (!store || (wanted && storeBase !== wanted)) {
        store = createGraphStore({ url: wanted });
        storeBase = wanted;
    }
    return store;
}

export async function sparql(base, query) {
    return metaStore(base).query(query, { union: true });
}
