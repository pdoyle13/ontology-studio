// Saved queries: named SPARQL/SQL snippets persisted in their own meta graph
// (journaled + snapshotted like every other graph). Not part of the ontology —
// they live in graphs/queries and never leak into the active modeling scope.

import type { Endpoint } from './sparqlClient';
import { select, update } from './sparqlClient';
import { serializeTerm } from './mutations';

const STUDIO = 'https://studio.local/ns#';
export const QUERIES_GRAPH = 'https://studio.local/graphs/queries';
const DCT_TITLE = 'http://purl.org/dc/terms/title';

export interface SavedQuery {
    iri: string;
    title: string;
    mode: 'sparql' | 'sql';
    text: string;
    sourceId: string | null;
    /** Default values for {{name}} placeholders in the text. */
    params: Record<string, string>;
}

/** Unique {{name}} placeholders in query text, in order of appearance. */
export function extractParams(text: string): string[] {
    const out: string[] = [];
    for (const m of text.matchAll(/\{\{(\w+)\}\}/g)) if (!out.includes(m[1])) out.push(m[1]);
    return out;
}

/** Substitute {{name}} placeholders. Quoting is the template author's choice
 *  (write "{{city}}" for a string literal); missing values leave the token. */
export function applyParams(text: string, values: Record<string, string>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (tok, name) =>
        values[name] !== undefined && values[name] !== '' ? values[name] : tok,
    );
}

export function queryIri(title: string): string {
    const slug =
        title
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'query';
    return `https://studio.local/query/${slug}`;
}

export async function listSavedQueries(ep: Endpoint): Promise<SavedQuery[]> {
    const q = `
SELECT ?q ?title ?mode ?text ?src ?params WHERE {
  GRAPH <${QUERIES_GRAPH}> {
    ?q a <${STUDIO}SavedQuery> ; <${DCT_TITLE}> ?title ; <${STUDIO}queryMode> ?mode ; <${STUDIO}queryText> ?text .
    OPTIONAL { ?q <${STUDIO}sourceId> ?src }
    OPTIONAL { ?q <${STUDIO}queryParams> ?params }
  }
}
ORDER BY ?title`;
    const r = await select(ep, q);
    return r.bindings
        .filter((b) => b.q)
        .map((b) => {
            let params: Record<string, string> = {};
            try {
                params = b.params?.value ? JSON.parse(b.params.value) : {};
            } catch {
                /* malformed defaults are ignorable */
            }
            return {
                iri: b.q.value,
                title: b.title?.value ?? b.q.value,
                mode: (b.mode?.value === 'sql' ? 'sql' : 'sparql') as 'sparql' | 'sql',
                text: b.text?.value ?? '',
                sourceId: b.src?.value ?? null,
                params,
            };
        });
}

/** Upsert by IRI: any previous version of the same named query is replaced. */
export async function saveQuery(
    ep: Endpoint,
    q: Omit<SavedQuery, 'iri' | 'params'> & { iri?: string; params?: Record<string, string> },
): Promise<string> {
    const iri = q.iri ?? queryIri(q.title);
    const params = q.params && Object.keys(q.params).length ? q.params : null;
    const triples = [
        `<${iri}> a <${STUDIO}SavedQuery> .`,
        `<${iri}> <${DCT_TITLE}> ${serializeTerm({ type: 'literal', value: q.title })} .`,
        `<${iri}> <${STUDIO}queryMode> ${serializeTerm({ type: 'literal', value: q.mode })} .`,
        `<${iri}> <${STUDIO}queryText> ${serializeTerm({ type: 'literal', value: q.text })} .`,
        ...(q.sourceId
            ? [`<${iri}> <${STUDIO}sourceId> ${serializeTerm({ type: 'literal', value: q.sourceId })} .`]
            : []),
        ...(params
            ? [`<${iri}> <${STUDIO}queryParams> ${serializeTerm({ type: 'literal', value: JSON.stringify(params) })} .`]
            : []),
    ].join('\n');
    await update(
        ep,
        `DELETE WHERE { GRAPH <${QUERIES_GRAPH}> { <${iri}> ?p ?o } } ; INSERT DATA { GRAPH <${QUERIES_GRAPH}> { ${triples} } }`,
    );
    return iri;
}

export async function deleteSavedQuery(ep: Endpoint, iri: string): Promise<void> {
    await update(ep, `DELETE WHERE { GRAPH <${QUERIES_GRAPH}> { <${iri}> ?p ?o } }`);
}
