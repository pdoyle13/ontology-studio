// Data quality checks: rule-driven sweeps over the meta layer, persisted as
// timestamped snapshots so Govern can show trends. Checks are declarative
// SPARQL counts — adding one is adding an entry here.

import { sparql, metaStore } from '../core/meta.mjs';

const STUDIO = 'https://studio.local/ns#';
export const QUALITY_GRAPH = 'https://studio.local/graphs/quality';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const SH = 'http://www.w3.org/ns/shacl#';

export const CHECKS = [
  {
    id: 'classes-without-labels',
    label: 'Classes without labels',
    query: `SELECT (COUNT(DISTINCT ?c) AS ?n) WHERE { ?c a <${RDFS}Class> . FILTER NOT EXISTS { ?c <${RDFS}label> ?l } FILTER(isIRI(?c)) }`,
  },
  {
    id: 'classes-without-shapes',
    label: 'Classes without node shapes',
    query: `SELECT (COUNT(DISTINCT ?c) AS ?n) WHERE { ?c a <${RDFS}Class> . FILTER NOT EXISTS { ?s <${SH}targetClass> ?c } FILTER(isIRI(?c)) }`,
  },
  {
    id: 'concepts-without-definitions',
    label: 'Concepts without definitions',
    query: `SELECT (COUNT(DISTINCT ?c) AS ?n) WHERE { ?c a <${SKOS}Concept> . FILTER NOT EXISTS { ?c <${SKOS}definition> ?d } }`,
  },
  {
    id: 'orphan-concepts',
    label: 'Concepts in no scheme',
    query: `SELECT (COUNT(DISTINCT ?c) AS ?n) WHERE { ?c a <${SKOS}Concept> . FILTER NOT EXISTS { ?c <${SKOS}inScheme> ?s } }`,
  },
  {
    id: 'properties-without-domain',
    label: 'Properties without a domain',
    query: `SELECT (COUNT(DISTINCT ?p) AS ?n) WHERE { ?p a <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property> . FILTER NOT EXISTS { ?p <${RDFS}domain> ?d } }`,
  },
  {
    id: 'unaligned-business-fields',
    label: 'Mapped fields without a business concept',
    query: `SELECT (COUNT(DISTINCT ?prop) AS ?n) WHERE {
      GRAPH <https://studio.local/graphs/mappings> { ?pom <http://www.w3.org/ns/r2rml#predicate> ?prop }
      FILTER NOT EXISTS { GRAPH <https://studio.local/graphs/alignment> { ?prop <${STUDIO}businessConcept> ?bc } }
    }`,
  },
];

export async function runQualityChecks(oxigraph) {
  const results = [];
  for (const check of CHECKS) {
    try {
      const rows = await sparql(oxigraph, check.query);
      results.push({ id: check.id, label: check.label, count: Number(rows[0]?.n?.value ?? 0) });
    } catch {
      results.push({ id: check.id, label: check.label, count: -1 });
    }
  }
  return results;
}

export async function persistSnapshot(oxigraph, results, at) {
  const runIri = `${QUALITY_GRAPH}/run-${Date.parse(at).toString(36)}`;
  const t = [
    `<${runIri}> a <${STUDIO}QualityRun> .`,
    `<${runIri}> <${STUDIO}at> "${at}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`,
    ...results.map(
      (r) => `<${runIri}> <${STUDIO}check/${r.id.replace(/[^\w-]/g, '')}> "${r.count}"^^<http://www.w3.org/2001/XMLSchema#integer> .`
    ),
  ].join('\n');
  await metaStore(oxigraph).updateRaw(`INSERT DATA { GRAPH <${QUALITY_GRAPH}> { ${t} } }`);
  return runIri;
}

export async function readHistory(oxigraph, limit = 30) {
  const rows = await sparql(
    oxigraph,
    `SELECT ?run ?at ?p ?v WHERE {
      GRAPH <${QUALITY_GRAPH}> {
        ?run a <${STUDIO}QualityRun> ; <${STUDIO}at> ?at ; ?p ?v .
        FILTER(STRSTARTS(STR(?p), "${STUDIO}check/"))
      }
    } ORDER BY DESC(?at)`
  );
  const byRun = new Map();
  for (const b of rows) {
    const key = b.run.value;
    if (!byRun.has(key)) byRun.set(key, { at: b.at.value, checks: {} });
    byRun.get(key).checks[b.p.value.split('/').pop()] = Number(b.v.value);
  }
  return [...byRun.values()].slice(0, limit);
}
