// Undoable write commands: pair each mutation with its inverse and run it
// through the history store.
//
// SECURITY: the SPARQL these build is assembled by the pure builders below,
// which serialize every IRI through term.ts `iri()` — a hostile IRI (from
// import, the agent, or a typed rename) can't break out of the `<...>`.

import type { Endpoint } from './sparqlClient';
import { update } from './sparqlClient';
import type { TermValue } from './queries';
import { describeResource } from './queries';
import {
    insertTriple,
    deleteTriple,
    replaceTriple,
    insertTriples,
    deleteTriples,
    type TriplePattern,
} from './mutations';
import { iri, serializeTerm } from './term';
import { useHistory } from '../state/history';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const DEPRECATED = 'https://studio.local/ns#deprecated';

const graphWrap = (graph: string | null, triples: string): string =>
    graph ? `GRAPH ${iri(graph)} { ${triples} }` : triples;

// ---- pure SPARQL builders (validated IRIs; unit-tested) ----

/** INSERT/DELETE DATA text for a typed resource with an optional label. */
export function buildCreateResource(
    graph: string | null,
    resourceIri: string,
    typeIri: string,
    label?: string,
): { insert: string; delete: string } {
    const triples = [`${iri(resourceIri)} ${iri(RDF_TYPE)} ${iri(typeIri)} .`];
    if (label)
        triples.push(`${iri(resourceIri)} ${iri(RDFS_LABEL)} ${serializeTerm({ type: 'literal', value: label })} .`);
    const block = graphWrap(graph, triples.join('\n'));
    return { insert: `INSERT DATA { ${block} }`, delete: `DELETE DATA { ${block} }` };
}

/** INSERT/DELETE DATA text for an instance with initial property values. */
export function buildCreateInstance(
    graph: string | null,
    resourceIri: string,
    typeIri: string,
    label: string | undefined,
    props: { predicate: string; value: string; isIri: boolean; datatype?: string }[],
): { insert: string; delete: string } {
    const triples = [`${iri(resourceIri)} ${iri(RDF_TYPE)} ${iri(typeIri)} .`];
    if (label)
        triples.push(`${iri(resourceIri)} ${iri(RDFS_LABEL)} ${serializeTerm({ type: 'literal', value: label })} .`);
    for (const p of props) {
        const term: TermValue = p.isIri
            ? { type: 'uri', value: p.value }
            : { type: 'literal', value: p.value, datatype: p.datatype };
        triples.push(`${iri(resourceIri)} ${iri(p.predicate)} ${serializeTerm(term)} .`);
    }
    const block = graphWrap(graph, triples.join('\n'));
    return { insert: `INSERT DATA { ${block} }`, delete: `DELETE DATA { ${block} }` };
}

/** DELETE-WHERE text for a resource (outgoing, optionally incoming too). */
export function buildDeleteResource(graph: string | null, resourceIri: string, alsoIncoming: boolean): string {
    const s = iri(resourceIri);
    const out = graph ? `DELETE WHERE { GRAPH ${iri(graph)} { ${s} ?p ?o } }` : `DELETE WHERE { ${s} ?p ?o }`;
    const inn = graph ? `DELETE WHERE { GRAPH ${iri(graph)} { ?s ?p ${s} } }` : `DELETE WHERE { ?s ?p ${s} }`;
    return alsoIncoming ? `${out} ; ${inn}` : out;
}

/** Rewrite every occurrence of one IRI to another across subject/predicate/object. */
export function buildRenameIri(oldIri: string, newIri: string): string {
    const a = iri(oldIri);
    const b = iri(newIri);
    return [
        `DELETE { GRAPH ?g { ${a} ?p ?o } } INSERT { GRAPH ?g { ${b} ?p ?o } } WHERE { GRAPH ?g { ${a} ?p ?o } }`,
        `DELETE { ${a} ?p ?o } INSERT { ${b} ?p ?o } WHERE { ${a} ?p ?o }`,
        `DELETE { GRAPH ?g { ?s ${a} ?o } } INSERT { GRAPH ?g { ?s ${b} ?o } } WHERE { GRAPH ?g { ?s ${a} ?o } }`,
        `DELETE { ?s ${a} ?o } INSERT { ?s ${b} ?o } WHERE { ?s ${a} ?o }`,
        `DELETE { GRAPH ?g { ?s ?p ${a} } } INSERT { GRAPH ?g { ?s ?p ${b} } } WHERE { GRAPH ?g { ?s ?p ${a} } }`,
        `DELETE { ?s ?p ${a} } INSERT { ?s ?p ${b} } WHERE { ?s ?p ${a} }`,
    ].join(' ;\n');
}

/** INSERT/DELETE text for the deprecated flag on a resource. */
export function buildSetDeprecated(graph: string | null, resourceIri: string): { add: string; del: string } {
    const triple = `${iri(resourceIri)} ${iri(DEPRECATED)} true .`;
    const add = `INSERT DATA { ${graphWrap(graph, triple)} }`;
    const del = `DELETE WHERE { GRAPH ?g { ${iri(resourceIri)} ${iri(DEPRECATED)} ?v } } ; DELETE WHERE { ${iri(resourceIri)} ${iri(DEPRECATED)} ?v }`;
    return { add, del };
}

// ---- commands (unchanged signatures; now inverse-paired through the builders) ----

/** One undoable step inserting several triples at once. */
export async function cmdInsertMany(
    ep: Endpoint,
    graph: string | null,
    triples: TriplePattern[],
    label = 'add values',
): Promise<void> {
    await useHistory.getState().exec({
        label,
        redo: () => insertTriples(ep, graph, triples),
        undo: () => deleteTriples(ep, graph, triples),
    });
}

export async function cmdInsert(
    ep: Endpoint,
    graph: string | null,
    s: string,
    p: string,
    o: TermValue,
    label = 'add value',
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
    label = 'delete value',
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
    newO: TermValue,
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
    resourceIri: string,
    typeIri: string,
    label?: string,
): Promise<void> {
    const q = buildCreateResource(graph, resourceIri, typeIri, label);
    await useHistory.getState().exec({
        label: 'create resource',
        redo: () => update(ep, q.insert),
        undo: () => update(ep, q.delete),
    });
}

/** Create an instance with initial property values as ONE undoable command. */
export async function cmdCreateInstanceFull(
    ep: Endpoint,
    graph: string | null,
    resourceIri: string,
    typeIri: string,
    label: string | undefined,
    props: { predicate: string; value: string; isIri: boolean; datatype?: string }[],
): Promise<void> {
    const q = buildCreateInstance(graph, resourceIri, typeIri, label, props);
    await useHistory.getState().exec({
        label: 'create instance',
        redo: () => update(ep, q.insert),
        undo: () => update(ep, q.delete),
    });
}

/** Delete a resource with full snapshot for undo (outgoing + incoming, bounded by describe limits). */
export async function cmdDeleteResource(
    ep: Endpoint,
    graph: string | null,
    resourceIri: string,
    alsoIncoming: boolean,
): Promise<void> {
    const d = await describeResource(ep, graph, resourceIri);
    const outBlock = d.outgoing
        .filter((s) => s.object.type !== 'bnode')
        .map((s) => `${iri(resourceIri)} ${iri(s.predicate)} ${serializeTerm(s.object)} .`)
        .join('\n');
    const inBlock = alsoIncoming
        ? d.incoming.map((s) => `${iri(s.subject)} ${iri(s.predicate)} ${iri(resourceIri)} .`).join('\n')
        : '';
    const snapshot = graphWrap(graph, [outBlock, inBlock].filter(Boolean).join('\n'));
    await useHistory.getState().exec({
        label: 'delete resource',
        redo: () => update(ep, buildDeleteResource(graph, resourceIri, alsoIncoming)),
        undo: () => update(ep, `INSERT DATA { ${snapshot} }`),
    });
}

/** Rename an IRI everywhere: subject, predicate, and object positions across
 *  every named graph and the default graph. One undoable command. */
export async function cmdRenameIri(ep: Endpoint, oldIri: string, newIri: string): Promise<void> {
    await useHistory.getState().exec({
        label: 'rename IRI',
        redo: () => update(ep, buildRenameIri(oldIri, newIri)),
        undo: () => update(ep, buildRenameIri(newIri, oldIri)),
    });
}

export async function cmdSetDeprecated(
    ep: Endpoint,
    graph: string | null,
    resourceIri: string,
    on: boolean,
): Promise<void> {
    const { add, del } = buildSetDeprecated(graph, resourceIri);
    await useHistory.getState().exec({
        label: on ? 'deprecate' : 'undeprecate',
        redo: () => update(ep, on ? add : del),
        undo: () => update(ep, on ? del : add),
    });
}
