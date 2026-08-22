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
