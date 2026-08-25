// Crosswalks: inter-vocabulary SKOS mappings (exact/close/broad/narrow/related
// Match) between two concept schemes, stored in their own graph. Suggestions
// are label-based (normalized-exact + token-overlap) — the agent can refine,
// but the baseline needs no LLM.

const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
export const CROSSWALKS_GRAPH = 'https://studio.local/graphs/crosswalks';

export const MAPPING_RELATIONS = ['exactMatch', 'closeMatch', 'broadMatch', 'narrowMatch', 'relatedMatch'];

async function sparql(oxigraph, q) {
  const res = await fetch(`${oxigraph}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' },
    body: q,
  });
  if (!res.ok) throw new Error(`crosswalk query ${res.status}`);
  return (await res.json()).results.bindings;
}

async function update(oxigraph, u) {
  const res = await fetch(`${oxigraph}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sparql-update' },
    body: u,
  });
  if (!res.ok) throw new Error(`crosswalk update ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter(Boolean));

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

async function schemeConcepts(oxigraph, scheme) {
  const rows = await sparql(
    oxigraph,
    `SELECT ?c (SAMPLE(?pl) AS ?label) (GROUP_CONCAT(DISTINCT ?al; separator="\\u0001") AS ?alts) WHERE {
  GRAPH ?g {
    ?c <${SKOS}inScheme> <${scheme}> .
    OPTIONAL { ?c <${SKOS}prefLabel> ?pl }
    OPTIONAL { ?c <${RDFS}label> ?pl }
    OPTIONAL { ?c <${SKOS}altLabel> ?al }
  }
} GROUP BY ?c`
  );
  return rows
    .filter((b) => b.c)
    .map((b) => ({
      iri: b.c.value,
      label: b.label?.value ?? b.c.value.split(/[#/]/).pop(),
      alts: (b.alts?.value ?? '').split(String.fromCharCode(1)).filter(Boolean),
    }));
}

async function existingMappings(oxigraph, fromScheme, toScheme) {
  const rows = await sparql(
    oxigraph,
    `SELECT ?from ?rel ?to WHERE {
  GRAPH <${CROSSWALKS_GRAPH}> { ?from ?rel ?to }
  GRAPH ?g1 { ?from <${SKOS}inScheme> <${fromScheme}> }
  GRAPH ?g2 { ?to <${SKOS}inScheme> <${toScheme}> }
}`
  );
  return rows.map((b) => ({ from: b.from.value, relation: b.rel.value.split('#').pop(), to: b.to.value }));
}

/** Ranked mapping candidates between two schemes, minus already-mapped pairs. */
export async function suggestCrosswalk(oxigraph, { fromScheme, toScheme, limit = 50 }) {
  const [fromCs, toCs, existing] = await Promise.all([
    schemeConcepts(oxigraph, fromScheme),
    schemeConcepts(oxigraph, toScheme),
    existingMappings(oxigraph, fromScheme, toScheme),
  ]);
  const mapped = new Set(existing.map((m) => `${m.from}|${m.to}`));
  const out = [];
  for (const f of fromCs) {
    const fNames = [f.label, ...f.alts];
    const fTok = tokens(f.label);
    for (const t of toCs) {
      if (mapped.has(`${f.iri}|${t.iri}`)) continue;
      const tNames = [t.label, ...t.alts];
      const exact = fNames.some((a) => tNames.some((b) => norm(a) === norm(b) && norm(a).length > 0));
      if (exact) {
        out.push({ from: f.iri, fromLabel: f.label, to: t.iri, toLabel: t.label, score: 0.95, basis: 'label-exact' });
        continue;
      }
      const j = jaccard(fTok, tokens(t.label));
      if (j >= 0.5) {
        out.push({ from: f.iri, fromLabel: f.label, to: t.iri, toLabel: t.label, score: Math.round(j * 80) / 100, basis: 'token-overlap' });
      }
    }
  }
  out.sort((a, b) => b.score - a.score || a.fromLabel.localeCompare(b.fromLabel));
  return { fromScheme, toScheme, existing, suggestions: out.slice(0, limit) };
}

export async function acceptMapping(oxigraph, { from, to, relation = 'exactMatch' }) {
  if (!MAPPING_RELATIONS.includes(relation)) throw new Error(`relation must be one of ${MAPPING_RELATIONS.join(', ')}`);
  await update(oxigraph, `INSERT DATA { GRAPH <${CROSSWALKS_GRAPH}> { <${from}> <${SKOS}${relation}> <${to}> } }`);
  return { from, relation, to };
}

export async function removeMapping(oxigraph, { from, to, relation }) {
  if (!MAPPING_RELATIONS.includes(relation)) throw new Error(`relation must be one of ${MAPPING_RELATIONS.join(', ')}`);
  await update(oxigraph, `DELETE DATA { GRAPH <${CROSSWALKS_GRAPH}> { <${from}> <${SKOS}${relation}> <${to}> } }`);
  return { removed: true };
}

export async function listMappings(oxigraph, { fromScheme, toScheme }) {
  return existingMappings(oxigraph, fromScheme, toScheme);
}
