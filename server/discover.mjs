// Business-area auto-discovery: match every mapped data field (from the R2RML
// catalog) against the FIBO vocabulary graph, and write the alignment into a
// governed alignment graph. The matcher's knowledge lives IN the graph
// (skos:altLabel keywords on FIBO classes) — tuning it is a data edit.

export const FIBO_GRAPH = 'https://studio.local/graphs/fibo';
export const ALIGNMENT_GRAPH = 'https://studio.local/graphs/alignment';
const STUDIO = 'https://studio.local/ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';

async function sparql(oxigraph, query) {
  const res = await fetch(`${oxigraph}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' },
    body: query,
  });
  if (!res.ok) throw new Error(`fibo query ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).results.bindings;
}

async function update(oxigraph, u) {
  const res = await fetch(`${oxigraph}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sparql-update' },
    body: u,
  });
  if (!res.ok) throw new Error(`alignment update ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** Load the FIBO concept index: [{iri, label, area, keywords[]}]. */
export async function loadFiboIndex(oxigraph) {
  const rows = await sparql(
    oxigraph,
    `SELECT ?c ?label ?area ?kw WHERE {
  GRAPH <${FIBO_GRAPH}> {
    ?c <${RDFS}label> ?label ; <${STUDIO}businessArea> ?area .
    OPTIONAL { ?c <${SKOS}altLabel> ?kw }
  }
}`
  );
  const byIri = new Map();
  for (const b of rows) {
    if (!byIri.has(b.c.value)) byIri.set(b.c.value, { iri: b.c.value, label: b.label.value, area: b.area.value, keywords: [] });
    if (b.kw) byIri.get(b.c.value).keywords.push(b.kw.value.toLowerCase());
  }
  return [...byIri.values()];
}

export const tokenize = (name) =>
  String(name)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();

/**
 * Match one field name against the FIBO index.
 * Scoring: exact keyword phrase = 3, keyword is a whole word in the name = 2,
 * name token equals a keyword token = 1. Highest total wins; ties → longer keyword.
 */
export function matchField(name, index) {
  const phrase = tokenize(name);
  const words = new Set(phrase.split(' '));
  let best = null;
  for (const concept of index) {
    let score = 0;
    let hit = null;
    for (const kw of concept.keywords) {
      if (kw === phrase) {
        score = Math.max(score, 3);
        hit = kw;
      } else if (phrase.includes(` ${kw} `) || phrase.startsWith(`${kw} `) || phrase.endsWith(` ${kw}`)) {
        if (score < 2) { score = 2; hit = kw; }
      } else if (words.has(kw)) {
        if (score < 1) { score = 1; hit = kw; }
      }
    }
    if (score > 0 && (!best || score > best.score || (score === best.score && (hit?.length ?? 0) > (best.hit?.length ?? 0)))) {
      best = { concept, score, hit };
    }
  }
  return best; // null when nothing matched
}

/**
 * Run discovery over the whole catalog. Writes alignment triples:
 *   <fieldProperty> studio:businessConcept <fiboClass> .
 *   <tableClass>    studio:businessConcept <fiboClass> .   (table-level match)
 * into the alignment graph. Returns the report.
 */
export async function discoverBusinessAreas({ oxigraph, catalog }) {
  const index = await loadFiboIndex(oxigraph);
  if (index.length === 0) throw new Error(`FIBO vocabulary graph is empty — load seed/fibo-core.ttl into <${FIBO_GRAPH}> first`);
  const report = [];
  const triples = [];
  for (const entry of catalog) {
    const tableMatch = matchField(entry.table, index);
    if (tableMatch) {
      triples.push(`<${entry.classIri}> <${STUDIO}businessConcept> <${tableMatch.concept.iri}> .`);
      report.push({
        kind: 'class', sourceId: entry.sourceId, table: entry.table, field: entry.table,
        property: entry.classIri, concept: tableMatch.concept.iri, conceptLabel: tableMatch.concept.label,
        area: tableMatch.concept.area, confidence: tableMatch.score,
      });
    }
    for (const col of entry.columns) {
      const m = matchField(col.column, index);
      if (!m) continue;
      triples.push(`<${col.property}> <${STUDIO}businessConcept> <${m.concept.iri}> .`);
      report.push({
        kind: 'column', sourceId: entry.sourceId, table: entry.table, field: col.column,
        property: col.property, concept: m.concept.iri, conceptLabel: m.concept.label,
        area: m.concept.area, confidence: m.score,
      });
    }
  }
  if (triples.length) {
    // idempotent refresh: rebuild the alignment graph from scratch
    await update(oxigraph, `DROP SILENT GRAPH <${ALIGNMENT_GRAPH}>`);
    await update(oxigraph, `INSERT DATA { GRAPH <${ALIGNMENT_GRAPH}> {\n${[...new Set(triples)].join('\n')}\n} }`);
  }
  const areas = {};
  for (const r of report) areas[r.area] = (areas[r.area] ?? 0) + 1;
  return { fields: report.length, areas, report };
}

/** Alignment lookup used to enrich the catalog: property IRI → {concept, label, area}. */
export async function readAlignment(oxigraph) {
  const rows = await sparql(
    oxigraph,
    `SELECT ?p ?c ?label ?area WHERE {
  GRAPH <${ALIGNMENT_GRAPH}> { ?p <${STUDIO}businessConcept> ?c }
  GRAPH <${FIBO_GRAPH}> { ?c <${RDFS}label> ?label ; <${STUDIO}businessArea> ?area }
}`
  );
  const map = new Map();
  for (const b of rows) map.set(b.p.value, { concept: b.c.value, conceptLabel: b.label.value, area: b.area.value });
  return map;
}
