// Query builders. All queries are graph-scope aware: pass the active named graph
// (or null to search the default graph plus all named graphs).

import type { Endpoint, SelectBinding } from './sparqlClient';
import { select } from './sparqlClient';

/** Wrap a pattern in the active graph scope. null scope = default ∪ all named graphs. */
export function scoped(pattern: string, graph: string | null): string {
  if (graph) return `GRAPH <${graph}> { ${pattern} }`;
  return `{ { ${pattern} } UNION { GRAPH ?__g { ${pattern} } } }`;
}

export interface ClassInfo {
  iri: string;
  label: string | null;
  instances: number;
  superClass: string | null;
}

export async function fetchClasses(ep: Endpoint, graph: string | null): Promise<ClassInfo[]> {
  const q = `
SELECT ?cls (SAMPLE(?lbl) AS ?label) (SAMPLE(?sup) AS ?superClass) (COUNT(DISTINCT ?inst) AS ?n) WHERE {
  ${scoped(
    `{ ?cls a <http://www.w3.org/2000/01/rdf-schema#Class> }
     UNION { ?cls a <http://www.w3.org/2002/07/owl#Class> }
     UNION { ?someInst a ?cls }
     OPTIONAL { ?cls <http://www.w3.org/2000/01/rdf-schema#label> ?lbl }
     OPTIONAL { ?cls <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?sup }
     OPTIONAL { ?inst a ?cls }`,
    graph
  )}
  FILTER(isIRI(?cls))
}
GROUP BY ?cls ORDER BY DESC(?n) LIMIT 500`;
  const r = await select(ep, q);
  return r.bindings
    .filter((b) => b.cls)
    .map((b) => ({
      iri: b.cls.value,
      label: b.label?.value ?? null,
      instances: Number(b.n?.value ?? 0),
      superClass: b.superClass?.type === 'uri' ? b.superClass.value : null,
    }));
}

export interface InstanceInfo {
  iri: string;
  label: string | null;
}

export async function fetchInstances(
  ep: Endpoint,
  graph: string | null,
  classIri: string,
  search = '',
  limit = 200
): Promise<InstanceInfo[]> {
  const filter = search
    ? `FILTER(CONTAINS(LCASE(COALESCE(?lbl, STR(?inst))), LCASE(${JSON.stringify(search)})))`
    : '';
  const q = `
SELECT DISTINCT ?inst (SAMPLE(?l) AS ?lbl2) WHERE {
  ${scoped(
    `?inst a <${classIri}> .
     OPTIONAL { ?inst <http://www.w3.org/2000/01/rdf-schema#label> ?l }`,
    graph
  )}
  ${filter ? `OPTIONAL { ?inst <http://www.w3.org/2000/01/rdf-schema#label> ?lbl } ${filter}` : ''}
  FILTER(isIRI(?inst))
}
GROUP BY ?inst ORDER BY ?inst LIMIT ${limit}`;
  const r = await select(ep, q);
  return r.bindings.filter((b) => b.inst).map((b) => ({ iri: b.inst.value, label: b.lbl2?.value ?? null }));
}

/** Global label/IRI substring search across the scope. */
export async function searchResources(
  ep: Endpoint,
  graph: string | null,
  text: string,
  limit = 50
): Promise<InstanceInfo[]> {
  const q = `
SELECT DISTINCT ?r (SAMPLE(?l) AS ?lbl) WHERE {
  ${scoped(
    `{ ?r ?p ?o } UNION { ?s2 ?p2 ?r . FILTER(isIRI(?r)) }
     OPTIONAL { ?r <http://www.w3.org/2000/01/rdf-schema#label> ?l }`,
    graph
  )}
  FILTER(isIRI(?r))
  FILTER(CONTAINS(LCASE(COALESCE(?l, STR(?r))), LCASE(${JSON.stringify(text)})))
}
GROUP BY ?r LIMIT ${limit}`;
  const r = await select(ep, q);
  return r.bindings.filter((b) => b.r).map((b) => ({ iri: b.r.value, label: b.lbl?.value ?? null }));
}

export interface TermValue {
  type: 'uri' | 'literal' | 'bnode';
  value: string;
  lang?: string;
  datatype?: string;
  label?: string; // for uri objects: their rdfs:label if any
}

export interface Statement {
  predicate: string;
  object: TermValue;
}

export interface IncomingStatement {
  subject: string;
  subjectLabel: string | null;
  predicate: string;
}

export interface ResourceDescription {
  iri: string;
  label: string | null;
  types: string[];
  outgoing: Statement[];
  incoming: IncomingStatement[];
  incomingTotal: number;
}

function toTerm(b: SelectBinding[string], label?: string): TermValue {
  return {
    type: b.type,
    value: b.value,
    lang: b['xml:lang'],
    datatype: b.datatype,
    label,
  };
}

export async function describeResource(
  ep: Endpoint,
  graph: string | null,
  iri: string
): Promise<ResourceDescription> {
  const outQ = `
SELECT ?p ?o (SAMPLE(?ol) AS ?olbl) WHERE {
  ${scoped(
    `<${iri}> ?p ?o .
     OPTIONAL { ?o <http://www.w3.org/2000/01/rdf-schema#label> ?ol }`,
    graph
  )}
}
GROUP BY ?p ?o ORDER BY ?p LIMIT 1000`;
  const inQ = `
SELECT ?s ?p (SAMPLE(?sl) AS ?slbl) WHERE {
  ${scoped(
    `?s ?p <${iri}> .
     OPTIONAL { ?s <http://www.w3.org/2000/01/rdf-schema#label> ?sl }`,
    graph
  )}
}
GROUP BY ?s ?p ORDER BY ?p LIMIT 200`;

  const [outR, inR] = await Promise.all([select(ep, outQ), select(ep, inQ)]);

  const outgoing: Statement[] = [];
  const types: string[] = [];
  let label: string | null = null;
  for (const b of outR.bindings) {
    if (!b.p || !b.o) continue;
    const p = b.p.value;
    if (p === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' && b.o.type === 'uri') types.push(b.o.value);
    if (p === 'http://www.w3.org/2000/01/rdf-schema#label' && label === null) label = b.o.value;
    outgoing.push({ predicate: p, object: toTerm(b.o, b.olbl?.value) });
  }
  const incoming: IncomingStatement[] = inR.bindings
    .filter((b) => b.s && b.p)
    .map((b) => ({ subject: b.s.value, subjectLabel: b.slbl?.value ?? null, predicate: b.p.value }));

  return { iri, label, types, outgoing, incoming, incomingTotal: incoming.length };
}
