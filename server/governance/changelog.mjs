// Durable audit trail: every write records a change activity in the changelog
// graph — who (actor), when, what kind of operation, which graphs, and the
// (truncated) change text. Queryable like everything else in the meta layer.

export const CHANGELOG_GRAPH = 'https://studio.local/graphs/changelog';
const STUDIO = 'https://studio.local/ns#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const PROV = 'http://www.w3.org/ns/prov#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '');

let seq = 0;

/** Fire-and-forget change record. Never blocks or fails the write it describes. */
export function recordChange(oxigraph, { actor, operation, graphs = [], detail = '' }) {
    const now = new Date().toISOString();
    const iri = `${STUDIO}change/${now.replace(/[-:.TZ]/g, '')}-${seq++}`;
    const lines = [
        `<${iri}> <${RDF}type> <${PROV}Activity> .`,
        `<${iri}> <${RDF}type> <${STUDIO}Change> .`,
        `<${iri}> <${STUDIO}actor> "${esc(actor || 'anonymous')}" .`,
        `<${iri}> <${STUDIO}operation> "${esc(operation)}" .`,
        `<${iri}> <${PROV}endedAtTime> "${now}"^^<${XSD}dateTime> .`,
        detail ? `<${iri}> <${STUDIO}detail> "${esc(String(detail).slice(0, 800))}" .` : '',
        ...graphs.filter(Boolean).map((g) => `<${iri}> <${STUDIO}targetGraph> <${g}> .`),
    ].filter(Boolean);
    fetch(`${oxigraph}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sparql-update' },
        body: `INSERT DATA { GRAPH <${CHANGELOG_GRAPH}> { ${lines.join('\n')} } }`,
    }).catch(() => {
        /* audit is best-effort, never blocks the write */
    });
}

/** Recent changes, newest first. */
export async function readChangelog(oxigraph, limit = 50) {
    const res = await fetch(`${oxigraph}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' },
        body: `SELECT ?c ?actor ?op ?at ?detail (GROUP_CONCAT(?g; separator="|") AS ?graphs) WHERE {
  GRAPH <${CHANGELOG_GRAPH}> {
    ?c <${STUDIO}actor> ?actor ; <${STUDIO}operation> ?op ; <${PROV}endedAtTime> ?at .
    OPTIONAL { ?c <${STUDIO}detail> ?detail }
    OPTIONAL { ?c <${STUDIO}targetGraph> ?g }
  }
} GROUP BY ?c ?actor ?op ?at ?detail ORDER BY DESC(?at) LIMIT ${Math.min(limit, 500)}`,
    });
    if (!res.ok) throw new Error(`changelog query ${res.status}`);
    return (await res.json()).results.bindings.map((b) => ({
        id: b.c.value,
        actor: b.actor.value,
        operation: b.op.value,
        at: b.at.value,
        detail: b.detail?.value ?? null,
        graphs: b.graphs?.value ? b.graphs.value.split('|').filter(Boolean) : [],
    }));
}
