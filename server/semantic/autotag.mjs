// Auto-tagging: find taxonomy concepts mentioned in free text. Label-based
// (prefLabel/rdfs:label/altLabel), word-boundary matched, longest-label-first
// so "machine learning" wins over "machine". No LLM required; the agent can
// call the same function as a tool for richer flows.

const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';

async function sparql(oxigraph, q) {
    const res = await fetch(`${oxigraph}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' },
        body: q,
    });
    if (!res.ok) throw new Error(`autotag query ${res.status}`);
    return (await res.json()).results.bindings;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function conceptLexicon(oxigraph, scheme) {
    const schemeFilter = scheme ? `?c <${SKOS}inScheme> <${scheme}> .` : `?c <${SKOS}inScheme> ?scheme .`;
    const rows = await sparql(
        oxigraph,
        `SELECT ?c ?scheme ?name WHERE {
  GRAPH ?g {
    ${schemeFilter}
    ${scheme ? `BIND(<${scheme}> AS ?scheme)` : ''}
    { ?c <${SKOS}prefLabel> ?name } UNION { ?c <${RDFS}label> ?name } UNION { ?c <${SKOS}altLabel> ?name }
  }
}`,
    );
    // name → concept entries (a name can belong to several concepts)
    const lex = [];
    const seen = new Set();
    for (const b of rows) {
        if (!b.c || !b.name?.value?.trim()) continue;
        const key = `${b.c.value}|${b.name.value.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        lex.push({ iri: b.c.value, scheme: b.scheme?.value ?? null, name: b.name.value.trim() });
    }
    // longest names first so multi-word labels claim their span
    lex.sort((a, b) => b.name.length - a.name.length);
    return lex;
}

/**
 * Tag free text with taxonomy concepts. Returns matches with counts and the
 * matched surface form; each text span is claimed once (longest label wins).
 */
// DoS bounds (P1.8): the matcher runs one regex per label over the whole text,
// so cost is O(labels × text). Cap both so a huge scheme or a huge input can't
// pin the event loop. (Labels are escaped, so no catastrophic backtracking.)
const MAX_TEXT = 100_000; // chars
const MAX_LABELS = 10_000;
const MAX_LABEL_LEN = 200;

export async function autoTag(oxigraph, { text, scheme = null, limit = 50 }) {
    const lex = await conceptLexicon(oxigraph, scheme);
    const body = String(text).slice(0, MAX_TEXT);
    const claimed = []; // [start, end) intervals already tagged
    const overlaps = (s, e) => claimed.some(([cs, ce]) => s < ce && e > cs);
    const byConcept = new Map();
    let processed = 0;
    for (const entry of lex) {
        if (entry.name.length < 3 || entry.name.length > MAX_LABEL_LEN) continue; // noise / pathological
        if (++processed > MAX_LABELS) break;
        const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(entry.name)}(?![\\p{L}\\p{N}])`, 'giu');
        for (const m of body.matchAll(re)) {
            const s = m.index;
            const e = s + m[0].length;
            if (overlaps(s, e)) continue;
            claimed.push([s, e]);
            const cur = byConcept.get(entry.iri) ?? {
                iri: entry.iri,
                scheme: entry.scheme,
                label: entry.name,
                count: 0,
                spans: [],
            };
            cur.count += 1;
            cur.spans.push({ start: s, end: e, surface: m[0] });
            byConcept.set(entry.iri, cur);
        }
    }
    return [...byConcept.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}
