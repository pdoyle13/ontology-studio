// Entity comment threads: one comment = one resource in the comments graph
// (on, by, at, text). Any authenticated role may comment — discussion is not
// a write to the model — but everything is journaled and broadcast.

import { sparql, metaStore } from '../core/meta.mjs';

const STUDIO = 'https://studio.local/ns#';
export const COMMENTS_GRAPH = 'https://studio.local/graphs/comments';

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

export async function addComment(oxigraph, { on, by, text, at }) {
    const id = `${COMMENTS_GRAPH}/c-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
    const t = [
        `<${id}> a <${STUDIO}Comment> .`,
        `<${id}> <${STUDIO}on> <${on}> .`,
        `<${id}> <${STUDIO}by> "${esc(by)}" .`,
        `<${id}> <${STUDIO}at> "${esc(at)}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`,
        `<${id}> <${STUDIO}text> "${esc(text)}" .`,
    ].join('\n');
    await metaStore(oxigraph).updateRaw(`INSERT DATA { GRAPH <${COMMENTS_GRAPH}> { ${t} } }`);
    return { id, on, by, at, text };
}

export async function listComments(oxigraph, on) {
    const rows = await sparql(
        oxigraph,
        `SELECT ?c ?by ?at ?text WHERE {
      GRAPH <${COMMENTS_GRAPH}> {
        ?c a <${STUDIO}Comment> ; <${STUDIO}on> <${on}> ; <${STUDIO}by> ?by ; <${STUDIO}at> ?at ; <${STUDIO}text> ?text .
      }
    } ORDER BY ?at`,
    );
    return rows.map((b) => ({ id: b.c.value, by: b.by.value, at: b.at.value, text: b.text.value }));
}
