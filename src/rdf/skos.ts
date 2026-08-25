// SKOS taxonomy support: concept schemes, broader/narrower trees, and
// undoable editing commands (create / re-parent / rename). prefLabel is the
// SKOS-native label — this is vocabulary data, not fabricated rdfs:labels.

import type { Endpoint } from './sparqlClient';
import { select, update } from './sparqlClient';
import { scoped } from './queries';
import { useHistory } from '../state/history';
import { serializeTerm } from './mutations';

export const SKOS = 'http://www.w3.org/2004/02/skos/core#';

export interface SchemeInfo {
  iri: string;
  label: string | null;
  conceptCount: number;
}

export interface ConceptRow {
  iri: string;
  label: string | null;
  broader: string | null;
  deprecated: boolean;
}

export interface ConceptNode {
  iri: string;
  label: string | null;
  children: ConceptNode[];
  deprecated?: boolean;
}

export async function listSchemes(ep: Endpoint, graph: string | null): Promise<SchemeInfo[]> {
  const q = `
SELECT ?s (SAMPLE(?l) AS ?lbl) (COUNT(DISTINCT ?c) AS ?n) WHERE {
  ${scoped(
    `?s a <${SKOS}ConceptScheme> .
     OPTIONAL { ?s <${SKOS}prefLabel> ?l }
     OPTIONAL { ?c <${SKOS}inScheme> ?s }`,
    graph
  )}
}
GROUP BY ?s ORDER BY ?s`;
  const r = await select(ep, q);
  return r.bindings
    .filter((b) => b.s)
    .map((b) => ({ iri: b.s.value, label: b.lbl?.value ?? null, conceptCount: Number(b.n?.value ?? 0) }));
}

export async function fetchConcepts(ep: Endpoint, graph: string | null, scheme: string): Promise<ConceptRow[]> {
  const q = `
SELECT ?c (SAMPLE(?l) AS ?lbl) (SAMPLE(?b) AS ?br) (SAMPLE(?dep) AS ?deprecated) WHERE {
  ${scoped(
    `?c <${SKOS}inScheme> <${scheme}> .
     OPTIONAL { ?c <${SKOS}prefLabel> ?l }
     OPTIONAL { ?c <${SKOS}broader> ?b }
     OPTIONAL { ?c <http://www.w3.org/2002/07/owl#deprecated> ?dep }`,
    graph
  )}
}
GROUP BY ?c ORDER BY ?lbl`;
  const r = await select(ep, q);
  return r.bindings
    .filter((b) => b.c)
    .map((b) => ({
      iri: b.c.value,
      label: b.lbl?.value ?? null,
      broader: b.br?.value ?? null,
      deprecated: b.deprecated?.value === 'true',
    }));
}

/** Deprecate/reactivate a code: deprecated codes stay valid data but leave
 *  every codelist pick-list. */
export async function cmdSetDeprecated(ep: Endpoint, graph: string | null, iri: string, deprecated: boolean): Promise<void> {
  const OWL_DEP = 'http://www.w3.org/2002/07/owl#deprecated';
  const wrap = (t: string) => (graph ? `GRAPH <${graph}> { ${t} }` : t);
  const set = `DELETE WHERE { ${wrap(`<${iri}> <${OWL_DEP}> ?v`)} } ; INSERT DATA { ${wrap(`<${iri}> <${OWL_DEP}> ${deprecated} `)} }`;
  const unset = `DELETE WHERE { ${wrap(`<${iri}> <${OWL_DEP}> ?v`)} } ; INSERT DATA { ${wrap(`<${iri}> <${OWL_DEP}> ${!deprecated} `)} }`;
  await useHistory.getState().exec({
    label: deprecated ? 'deprecate code' : 'reactivate code',
    redo: () => update(ep, set),
    undo: () => update(ep, unset),
  });
}

/** Active (non-deprecated) codes of a scheme — the live option list for
 *  codelist fields. */
export async function fetchActiveCodes(ep: Endpoint, scheme: string): Promise<{ iri: string; label: string }[]> {
  const q = `
SELECT ?c (SAMPLE(?l) AS ?lbl) WHERE {
  { ?c <${SKOS}inScheme> <${scheme}> . OPTIONAL { ?c <${SKOS}prefLabel> ?l } }
  UNION
  { GRAPH ?g { ?c <${SKOS}inScheme> <${scheme}> . OPTIONAL { ?c <${SKOS}prefLabel> ?l } } }
  FILTER NOT EXISTS { ?c <http://www.w3.org/2002/07/owl#deprecated> true }
  FILTER NOT EXISTS { GRAPH ?g2 { ?c <http://www.w3.org/2002/07/owl#deprecated> true } }
}
GROUP BY ?c ORDER BY ?lbl`;
  const r = await select(ep, q);
  return r.bindings.filter((b) => b.c).map((b) => ({ iri: b.c.value, label: b.lbl?.value ?? b.c.value.split(/[#/]/).pop()! }));
}

/** Pure: rows → forest. Concepts whose broader is missing/outside the scheme become roots.
 *  Cycles are broken by treating the back-edge's child as a root (never dropped, never looped). */
export function buildTaxonomyTree(rows: ConceptRow[]): ConceptNode[] {
  const byIri = new Map(rows.map((r) => [r.iri, { iri: r.iri, label: r.label, deprecated: r.deprecated, children: [] as ConceptNode[] }]));
  const roots: ConceptNode[] = [];
  for (const row of rows) {
    const node = byIri.get(row.iri)!;
    const parent = row.broader ? byIri.get(row.broader) : undefined;
    if (!parent) {
      roots.push(node);
      continue;
    }
    // walk up from the would-be parent; if we reach row.iri the edge closes a cycle
    let probe: string | null = row.broader;
    let cyclic = false;
    const guard = new Set<string>();
    while (probe && !guard.has(probe)) {
      if (probe === row.iri) {
        cyclic = true;
        break;
      }
      guard.add(probe);
      probe = rows.find((r) => r.iri === probe)?.broader ?? null;
    }
    if (cyclic) roots.push(node);
    else parent.children.push(node);
  }
  const sort = (ns: ConceptNode[]) => {
    ns.sort((a, b) => (a.label ?? a.iri).localeCompare(b.label ?? b.iri));
    ns.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

const wrap = (graph: string | null, t: string) => (graph ? `GRAPH <${graph}> { ${t} }` : t);

export async function cmdCreateScheme(ep: Endpoint, graph: string | null, iri: string, label: string): Promise<void> {
  const block = [
    `<${iri}> a <${SKOS}ConceptScheme> .`,
    `<${iri}> <${SKOS}prefLabel> ${serializeTerm({ type: 'literal', value: label })} .`,
  ].join('\n');
  await useHistory.getState().exec({
    label: 'create concept scheme',
    redo: () => update(ep, `INSERT DATA { ${wrap(graph, block)} }`),
    undo: () => update(ep, `DELETE DATA { ${wrap(graph, block)} }`),
  });
}

export async function cmdCreateConcept(
  ep: Endpoint,
  graph: string | null,
  opts: { iri: string; label: string; scheme: string; broader?: string | null }
): Promise<void> {
  const triples = [
    `<${opts.iri}> a <${SKOS}Concept> .`,
    `<${opts.iri}> <${SKOS}prefLabel> ${serializeTerm({ type: 'literal', value: opts.label })} .`,
    `<${opts.iri}> <${SKOS}inScheme> <${opts.scheme}> .`,
  ];
  if (opts.broader) triples.push(`<${opts.iri}> <${SKOS}broader> <${opts.broader}> .`);
  else triples.push(`<${opts.iri}> <${SKOS}topConceptOf> <${opts.scheme}> .`);
  const block = triples.join('\n');
  await useHistory.getState().exec({
    label: 'create concept',
    redo: () => update(ep, `INSERT DATA { ${wrap(graph, block)} }`),
    undo: () => update(ep, `DELETE DATA { ${wrap(graph, block)} }`),
  });
}

/** Move a concept under a new parent (or to the top level when newBroader is null). */
export async function cmdReparentConcept(
  ep: Endpoint,
  graph: string | null,
  opts: { concept: string; scheme: string; oldBroader: string | null; newBroader: string | null }
): Promise<void> {
  const { concept, scheme, oldBroader, newBroader } = opts;
  if (oldBroader === newBroader) return;
  const stateTriples = (broader: string | null) =>
    broader ? [`<${concept}> <${SKOS}broader> <${broader}> .`] : [`<${concept}> <${SKOS}topConceptOf> <${scheme}> .`];
  const apply = (from: string | null, to: string | null) =>
    update(
      ep,
      `DELETE DATA { ${wrap(graph, stateTriples(from).join('\n'))} } ; INSERT DATA { ${wrap(graph, stateTriples(to).join('\n'))} }`
    );
  await useHistory.getState().exec({
    label: 'move concept',
    redo: () => apply(oldBroader, newBroader),
    undo: () => apply(newBroader, oldBroader),
  });
}

export async function cmdRenameConcept(
  ep: Endpoint,
  graph: string | null,
  iri: string,
  oldLabel: string | null,
  newLabel: string
): Promise<void> {
  const del = oldLabel ? `DELETE DATA { ${wrap(graph, `<${iri}> <${SKOS}prefLabel> ${serializeTerm({ type: 'literal', value: oldLabel })} .`)} } ; ` : '';
  const ins = `INSERT DATA { ${wrap(graph, `<${iri}> <${SKOS}prefLabel> ${serializeTerm({ type: 'literal', value: newLabel })} .`)} }`;
  const insBack = oldLabel
    ? `DELETE DATA { ${wrap(graph, `<${iri}> <${SKOS}prefLabel> ${serializeTerm({ type: 'literal', value: newLabel })} .`)} } ; INSERT DATA { ${wrap(graph, `<${iri}> <${SKOS}prefLabel> ${serializeTerm({ type: 'literal', value: oldLabel })} .`)} }`
    : `DELETE DATA { ${wrap(graph, `<${iri}> <${SKOS}prefLabel> ${serializeTerm({ type: 'literal', value: newLabel })} .`)} }`;
  await useHistory.getState().exec({
    label: 'rename concept',
    redo: () => update(ep, `${del}${ins}`),
    undo: () => update(ep, insBack),
  });
}
