// Write path: single-triple granular updates via SPARQL UPDATE.
// All writes are scoped to the active named graph (or the default graph).

import type { Endpoint } from './sparqlClient';
import { update } from './sparqlClient';
import type { TermValue } from './queries';

export function serializeTerm(t: TermValue): string {
  if (t.type === 'uri') return `<${t.value}>`;
  if (t.type === 'bnode') return `_:${t.value}`;
  const escaped = t.value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  if (t.lang) return `"${escaped}"@${t.lang}`;
  if (t.datatype && t.datatype !== 'http://www.w3.org/2001/XMLSchema#string')
    return `"${escaped}"^^<${t.datatype}>`;
  return `"${escaped}"`;
}

function inGraph(graph: string | null, triples: string): string {
  return graph ? `GRAPH <${graph}> { ${triples} }` : triples;
}

export interface TriplePattern {
  s: string;
  p: string;
  o: TermValue;
}

const block = (triples: TriplePattern[]) =>
  triples.map((t) => `<${t.s}> <${t.p}> ${serializeTerm(t.o)} .`).join('\n');

export async function insertTriples(ep: Endpoint, graph: string | null, triples: TriplePattern[]): Promise<void> {
  if (!triples.length) return;
  await update(ep, `INSERT DATA { ${inGraph(graph, block(triples))} }`);
}

export async function deleteTriples(ep: Endpoint, graph: string | null, triples: TriplePattern[]): Promise<void> {
  if (!triples.length) return;
  await update(ep, `DELETE DATA { ${inGraph(graph, block(triples))} }`);
}

export async function insertTriple(
  ep: Endpoint,
  graph: string | null,
  subject: string,
  predicate: string,
  object: TermValue
): Promise<void> {
  await update(ep, `INSERT DATA { ${inGraph(graph, `<${subject}> <${predicate}> ${serializeTerm(object)} .`)} }`);
}

export async function deleteTriple(
  ep: Endpoint,
  graph: string | null,
  subject: string,
  predicate: string,
  object: TermValue
): Promise<void> {
  await update(ep, `DELETE DATA { ${inGraph(graph, `<${subject}> <${predicate}> ${serializeTerm(object)} .`)} }`);
}

export async function replaceTriple(
  ep: Endpoint,
  graph: string | null,
  subject: string,
  predicate: string,
  oldObject: TermValue,
  newObject: TermValue
): Promise<void> {
  const del = `<${subject}> <${predicate}> ${serializeTerm(oldObject)} .`;
  const ins = `<${subject}> <${predicate}> ${serializeTerm(newObject)} .`;
  await update(ep, `DELETE DATA { ${inGraph(graph, del)} } ; INSERT DATA { ${inGraph(graph, ins)} }`);
}

/** Create a resource with a type and optional label. */
export async function createResource(
  ep: Endpoint,
  graph: string | null,
  iri: string,
  typeIri: string,
  label?: string
): Promise<void> {
  const triples = [
    `<${iri}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${typeIri}> .`,
    label ? `<${iri}> <http://www.w3.org/2000/01/rdf-schema#label> ${serializeTerm({ type: 'literal', value: label })} .` : '',
  ]
    .filter(Boolean)
    .join('\n');
  await update(ep, `INSERT DATA { ${inGraph(graph, triples)} }`);
}

/** Delete a resource: all outgoing triples, and optionally all incoming references. */
export async function deleteResource(
  ep: Endpoint,
  graph: string | null,
  iri: string,
  alsoIncoming: boolean
): Promise<void> {
  const out = graph
    ? `DELETE WHERE { GRAPH <${graph}> { <${iri}> ?p ?o } }`
    : `DELETE WHERE { <${iri}> ?p ?o }`;
  const inn = graph
    ? `DELETE WHERE { GRAPH <${graph}> { ?s ?p <${iri}> } }`
    : `DELETE WHERE { ?s ?p <${iri}> }`;
  await update(ep, alsoIncoming ? `${out} ; ${inn}` : out);
}

/** Infer a sensible TermValue from a raw input string + desired kind. */
export function parseTermInput(
  raw: string,
  kind: 'auto' | 'iri' | 'string' | 'integer' | 'decimal' | 'boolean' | 'date' | 'dateTime',
  expandCurie: (s: string) => string
): TermValue {
  const v = raw.trim();
  if (kind === 'iri') return { type: 'uri', value: expandCurie(v) };
  const xsd = (t: string) => `http://www.w3.org/2001/XMLSchema#${t}`;
  if (kind === 'auto') {
    if (/^(https?|urn):/.test(v)) return { type: 'uri', value: v };
    if (/^[A-Za-z_][\w-]*:[\w.-]+$/.test(v) && expandCurie(v) !== v) return { type: 'uri', value: expandCurie(v) };
    if (/^-?\d+$/.test(v)) return { type: 'literal', value: v, datatype: xsd('integer') };
    if (/^-?\d*\.\d+$/.test(v)) return { type: 'literal', value: v, datatype: xsd('decimal') };
    if (v === 'true' || v === 'false') return { type: 'literal', value: v, datatype: xsd('boolean') };
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { type: 'literal', value: v, datatype: xsd('date') };
    return { type: 'literal', value: v };
  }
  if (kind === 'string') return { type: 'literal', value: v };
  return { type: 'literal', value: v, datatype: xsd(kind) };
}
