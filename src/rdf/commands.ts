// Undoable write commands: pair each mutation with its inverse and run it
// through the history store.

import type { Endpoint } from './sparqlClient';
import { update } from './sparqlClient';
import type { TermValue } from './queries';
import { describeResource } from './queries';
import { insertTriple, deleteTriple, replaceTriple, serializeTerm } from './mutations';
import { useHistory } from '../state/history';

export async function cmdInsert(
  ep: Endpoint,
  graph: string | null,
  s: string,
  p: string,
  o: TermValue,
  label = 'add value'
): Promise<void> {
  await useHistory.getState().exec({
    label,
    redo: () => insertTriple(ep, graph, s, p, o),
    undo: () => deleteTriple(ep, graph, s, p, o),
  });
}

export async function cmdDelete(
  ep: Endpoint,
  graph: string | null,
  s: string,
  p: string,
  o: TermValue,
  label = 'delete value'
): Promise<void> {
  await useHistory.getState().exec({
    label,
    redo: () => deleteTriple(ep, graph, s, p, o),
    undo: () => insertTriple(ep, graph, s, p, o),
  });
}

export async function cmdReplace(
  ep: Endpoint,
  graph: string | null,
  s: string,
  p: string,
  oldO: TermValue,
  newO: TermValue
): Promise<void> {
  await useHistory.getState().exec({
    label: 'edit value',
    redo: () => replaceTriple(ep, graph, s, p, oldO, newO),
    undo: () => replaceTriple(ep, graph, s, p, newO, oldO),
  });
}

export async function cmdCreateResource(
  ep: Endpoint,
  graph: string | null,
  iri: string,
  typeIri: string,
  label?: string
): Promise<void> {
  const triples: [string, string, TermValue][] = [
    [iri, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', { type: 'uri', value: typeIri }],
  ];
  if (label) triples.push([iri, 'http://www.w3.org/2000/01/rdf-schema#label', { type: 'literal', value: label }]);
  const block = triples.map(([s, p, o]) => `<${s}> <${p}> ${serializeTerm(o)} .`).join('\n');
  const wrap = (t: string) => (graph ? `GRAPH <${graph}> { ${t} }` : t);
  await useHistory.getState().exec({
    label: 'create resource',
    redo: () => update(ep, `INSERT DATA { ${wrap(block)} }`),
    undo: () => update(ep, `DELETE DATA { ${wrap(block)} }`),
  });
}

/** Create an instance with initial property values as ONE undoable command. */
export async function cmdCreateInstanceFull(
  ep: Endpoint,
  graph: string | null,
  iri: string,
  typeIri: string,
  label: string | undefined,
  props: { predicate: string; value: string; isIri: boolean; datatype?: string }[]
): Promise<void> {
  const triples: string[] = [`<${iri}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${typeIri}> .`];
  if (label) triples.push(`<${iri}> <http://www.w3.org/2000/01/rdf-schema#label> ${serializeTerm({ type: 'literal', value: label })} .`);
  for (const p of props) {
    const term: TermValue = p.isIri
      ? { type: 'uri', value: p.value }
      : { type: 'literal', value: p.value, datatype: p.datatype };
    triples.push(`<${iri}> <${p.predicate}> ${serializeTerm(term)} .`);
  }
  const block = triples.join('\n');
  const wrap = (t: string) => (graph ? `GRAPH <${graph}> { ${t} }` : t);
  await useHistory.getState().exec({
    label: 'create instance',
    redo: () => update(ep, `INSERT DATA { ${wrap(block)} }`),
    undo: () => update(ep, `DELETE DATA { ${wrap(block)} }`),
  });
}

/** Delete a resource with full snapshot for undo (outgoing + incoming, bounded by describe limits). */
export async function cmdDeleteResource(
  ep: Endpoint,
  graph: string | null,
  iri: string,
  alsoIncoming: boolean
): Promise<void> {
  const d = await describeResource(ep, graph, iri);
  const wrap = (t: string) => (graph ? `GRAPH <${graph}> { ${t} }` : t);
  const outBlock = d.outgoing
    .filter((s) => s.object.type !== 'bnode')
    .map((s) => `<${iri}> <${s.predicate}> ${serializeTerm(s.object)} .`)
    .join('\n');
  const inBlock = alsoIncoming
    ? d.incoming.map((s) => `<${s.subject}> <${s.predicate}> <${iri}> .`).join('\n')
    : '';
  const snapshot = [outBlock, inBlock].filter(Boolean).join('\n');
  const delOut = graph
    ? `DELETE WHERE { GRAPH <${graph}> { <${iri}> ?p ?o } }`
    : `DELETE WHERE { <${iri}> ?p ?o }`;
  const delIn = graph
    ? `DELETE WHERE { GRAPH <${graph}> { ?s ?p <${iri}> } }`
    : `DELETE WHERE { ?s ?p <${iri}> }`;
  await useHistory.getState().exec({
    label: 'delete resource',
    redo: () => update(ep, alsoIncoming ? `${delOut} ; ${delIn}` : delOut),
    undo: () => update(ep, `INSERT DATA { ${wrap(snapshot)} }`),
  });
}

/** Rename an IRI everywhere: subject, predicate, and object positions across
 *  every named graph and the default graph. One undoable command. */
export async function cmdRenameIri(ep: Endpoint, oldIri: string, newIri: string): Promise<void> {
  const move = (a: string, b: string) =>
    [
      `DELETE { GRAPH ?g { <${a}> ?p ?o } } INSERT { GRAPH ?g { <${b}> ?p ?o } } WHERE { GRAPH ?g { <${a}> ?p ?o } }`,
      `DELETE { <${a}> ?p ?o } INSERT { <${b}> ?p ?o } WHERE { <${a}> ?p ?o }`,
      `DELETE { GRAPH ?g { ?s <${a}> ?o } } INSERT { GRAPH ?g { ?s <${b}> ?o } } WHERE { GRAPH ?g { ?s <${a}> ?o } }`,
      `DELETE { ?s <${a}> ?o } INSERT { ?s <${b}> ?o } WHERE { ?s <${a}> ?o }`,
      `DELETE { GRAPH ?g { ?s ?p <${a}> } } INSERT { GRAPH ?g { ?s ?p <${b}> } } WHERE { GRAPH ?g { ?s ?p <${a}> } }`,
      `DELETE { ?s ?p <${a}> } INSERT { ?s ?p <${b}> } WHERE { ?s ?p <${a}> }`,
    ].join(' ;\n');
  await useHistory.getState().exec({
    label: 'rename IRI',
    redo: () => update(ep, move(oldIri, newIri)),
    undo: () => update(ep, move(newIri, oldIri)),
  });
}

const DEPRECATED = 'https://studio.local/ns#deprecated';

export async function cmdSetDeprecated(ep: Endpoint, graph: string | null, iri: string, on: boolean): Promise<void> {
  const triple = `<${iri}> <${DEPRECATED}> true .`;
  const wrap = (t: string) => (graph ? `GRAPH <${graph}> { ${t} }` : t);
  const add = `INSERT DATA { ${wrap(triple)} }`;
  const del = `DELETE WHERE { GRAPH ?g { <${iri}> <${DEPRECATED}> ?v } } ; DELETE WHERE { <${iri}> <${DEPRECATED}> ?v }`;
  await useHistory.getState().exec({
    label: on ? 'deprecate' : 'undeprecate',
    redo: () => update(ep, on ? add : del),
    undo: () => update(ep, on ? del : add),
  });
}
