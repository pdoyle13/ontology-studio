// Query builders. All queries are graph-scope aware: pass the active named graph
// (or null to search the default graph plus all named graphs).

import type { Endpoint, SelectBinding } from './sparqlClient';
import { select } from './sparqlClient';
import {
  virtualClasses,
  isVirtualClass,
  matchVirtualIri,
  fetchVirtualInstances,
  fetchVirtualDescribe,
} from './virtualApi';

/** Wrap a pattern in the active graph scope. null scope = default ∪ all named graphs. */
export function scoped(pattern: string, graph: string | null): string {
  if (graph) return `GRAPH <${graph}> { ${pattern} }`;
  return `{ { ${pattern} } UNION { GRAPH ?__g { ${pattern} } } }`;
}

const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const SH_NS = 'http://www.w3.org/ns/shacl#';
const DASH_NS = 'http://datashapes.org/dash#';

/**
 * Label resolution for a subject variable: rdfs:label when asserted, otherwise
 * the value of the property the class's shape designates via dash:propertyRole
 * dash:LabelRole (the DASH pattern — no fabricated labels in the data).
 * Binds the result to ?<out>. `sfx` keeps helper vars unique per usage.
 */
export function labelPattern(subjectVar: string, out: string, sfx: string): string {
  return `
     OPTIONAL { ${subjectVar} <${RDFS_LABEL}> ?__rl${sfx} }
     OPTIONAL {
       ${subjectVar} a ?__lc${sfx} .
       ?__lsh${sfx} <${SH_NS}targetClass> ?__lc${sfx} ; <${SH_NS}property> ?__lps${sfx} .
       ?__lps${sfx} <${DASH_NS}propertyRole> <${DASH_NS}LabelRole> ; <${SH_NS}path> ?__lp${sfx} .
       ${subjectVar} ?__lp${sfx} ?__dl${sfx} .
     }
     BIND(COALESCE(?__rl${sfx}, ?__dl${sfx}) AS ?${out})`;
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
  const classes = r.bindings
    .filter((b) => b.cls)
    .map((b) => ({
      iri: b.cls.value,
      label: b.label?.value ?? null,
      instances: Number(b.n?.value ?? 0),
      superClass: b.superClass?.type === 'uri' ? b.superClass.value : null,
    }));
  // virtual classes: instance data lives in SQL, so counts come from the sources
  try {
    const virt = await virtualClasses();
    const counts = new Map(virt.map((v) => [v.classIri, v.rowCount]));
    for (const c of classes) if (counts.has(c.iri)) c.instances = counts.get(c.iri)!;
    classes.sort((a, b) => b.instances - a.instances);
  } catch { /* virtual layer offline — schema counts stand */ }
  return classes;
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
  // virtual classes resolve live from their owning database
  if (await isVirtualClass(classIri)) return fetchVirtualInstances(classIri, search, limit);
  const filter = search
    ? `FILTER(CONTAINS(LCASE(COALESCE(?lbl, STR(?inst))), LCASE(${JSON.stringify(search)})))`
    : '';
  const q = `
SELECT DISTINCT ?inst (SAMPLE(?l) AS ?lbl2) WHERE {
  ${scoped(
    `?inst a/<${RDFS_LABEL.replace('label', 'subClassOf')}>* <${classIri}> .
     ${labelPattern('?inst', 'l', 'a')}`,
    graph
  )}
  ${filter ? `${filter.replace('?lbl', '?l')}` : ''}
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
     ${labelPattern('?r', 'l', 'b')}`,
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
  /** present when the resource lives in a SQL source (read-only in the UI) */
  virtual?: { sourceId: string; table: string };
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
  // virtual instances: one live row + field-level link traversal from the meta layer
  if (await matchVirtualIri(iri)) {
    const d = await fetchVirtualDescribe(iri);
    if (d && !d.missing) {
      return {
        iri: d.iri,
        label: d.label,
        types: d.types,
        outgoing: d.outgoing.map((o) => ({
          predicate: o.predicate,
          object: { type: o.object.type, value: o.object.value, datatype: o.object.datatype, label: o.object.label },
        })),
        incoming: d.incoming,
        incomingTotal: d.incomingTotal,
        virtual: d.virtual,
      };
    }
  }
  const outQ = `
SELECT ?p ?o (SAMPLE(?ol) AS ?olbl) WHERE {
  ${scoped(
    `<${iri}> ?p ?o .
     OPTIONAL { FILTER(isIRI(?o)) ${labelPattern('?o', 'ol', 'c')} }`,
    graph
  )}
}
GROUP BY ?p ?o ORDER BY ?p LIMIT 1000`;
  const inQ = `
SELECT ?s ?p (SAMPLE(?sl) AS ?slbl) WHERE {
  ${scoped(
    `?s ?p <${iri}> .
     ${labelPattern('?s', 'sl', 'd')}`,
    graph
  )}
}
GROUP BY ?s ?p ORDER BY ?p LIMIT 200`;

  const selfLabelQ = `
SELECT ?l WHERE {
  ${scoped(`BIND(<${iri}> AS ?self) ${labelPattern('?self', 'l', 'e')}`, graph)}
  FILTER(BOUND(?l))
} LIMIT 1`;
  const [outR, inR, selfR] = await Promise.all([select(ep, outQ), select(ep, inQ), select(ep, selfLabelQ)]);

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

  const resolvedLabel = label ?? selfR.bindings[0]?.l?.value ?? null;
  return { iri, label: resolvedLabel, types, outgoing, incoming, incomingTotal: incoming.length };
}
