// SPARQL AST utilities via Traqula (Comunica's parser toolkit). First adoption
// site: replace regex surgery on update bodies with real parsing. Every
// helper degrades gracefully — parse failures fall back to the regex the code
// used before, so exotic-but-valid inputs never hard-fail.

import { Parser } from '@traqula/parser-sparql-1-1';

const parser = new Parser();

/** Walk any AST node, invoking visit(node) on every object with a `type`. */
function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (const x of node) walk(x, visit);
        return;
    }
    if (node.type) visit(node);
    for (const k of Object.keys(node)) {
        if (k === 'loc') continue;
        walk(node[k], visit);
    }
}

/**
 * Graph IRIs a SPARQL update touches (GRAPH blocks, USING/WITH, quad data).
 * Returns [] when the update names no graph (= default graph / unknown).
 * Falls back to the GRAPH<> regex when the body doesn't parse.
 */
export function updateGraphTags(body) {
    const text = String(body);
    try {
        const ast = parser.parse(text);
        const tags = new Set();
        walk(ast, (n) => {
            // GRAPH <g> { … } groups in data blocks and patterns
            if (n.type === 'graph' && n.graph?.subType === 'namedNode') tags.add(n.graph.value);
            if (n.subType === 'graph' && n.name?.subType === 'namedNode') tags.add(n.name.value);
            // WITH <g> / USING <g> / GRAPH refs on operations
            for (const key of ['graph', 'using', 'destination', 'source']) {
                const v = n[key];
                if (v && v.subType === 'namedNode' && typeof v.value === 'string') tags.add(v.value);
            }
        });
        return [...tags];
    } catch {
        const tags = new Set();
        for (const m of text.matchAll(/GRAPH\s*<([^>]+)>/gi)) tags.add(m[1]);
        return [...tags];
    }
}
