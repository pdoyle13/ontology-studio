// JSON-LD export: n3 quads → flat JSON-LD (one node object per subject,
// @context from the prefix map). Pure and dependency-free — the studio's
// graphs are meta-layer sized, so a straightforward grouping serializer is
// all this needs.

import type { Quad } from 'n3';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

interface PrefixLike {
    shrink: (iri: string) => string;
    entries: () => Record<string, string>;
}

function objectValue(q: Quad, shrink: (iri: string) => string): unknown {
    const o = q.object;
    if (o.termType === 'NamedNode') return { '@id': shrink(o.value) };
    if (o.termType === 'BlankNode') return { '@id': `_:${o.value}` };
    const lit = o as { value: string; language?: string; datatype?: { value: string } };
    if (lit.language) return { '@value': lit.value, '@language': lit.language };
    const dt = lit.datatype?.value;
    if (dt && dt !== XSD_STRING) return { '@value': lit.value, '@type': shrink(dt) };
    return lit.value;
}

/** Pure: quads + prefixes → flat JSON-LD document. */
export function quadsToJsonLd(quads: Quad[], prefixes: PrefixLike): object {
    const shrink = (iri: string) => prefixes.shrink(iri);
    const bySubject = new Map<string, Record<string, unknown[]>>();
    const usedNs = new Set<string>();

    const note = (iri: string) => {
        const short = shrink(iri);
        if (short !== iri && short.includes(':')) usedNs.add(short.split(':')[0]);
    };

    for (const q of quads) {
        const s = q.subject.termType === 'BlankNode' ? `_:${q.subject.value}` : q.subject.value;
        note(q.subject.value);
        note(q.predicate.value);
        if (q.object.termType === 'NamedNode') note(q.object.value);
        if (!bySubject.has(s)) bySubject.set(s, {});
        const node = bySubject.get(s)!;
        const key = q.predicate.value === RDF_TYPE ? '@type' : shrink(q.predicate.value);
        if (!node[key]) node[key] = [];
        node[key].push(q.predicate.value === RDF_TYPE ? shrink(q.object.value) : objectValue(q, shrink));
    }

    const context: Record<string, string> = {};
    for (const [prefix, ns] of Object.entries(prefixes.entries())) if (usedNs.has(prefix)) context[prefix] = ns;

    const graph = [...bySubject.entries()].map(([id, props]) => {
        const node: Record<string, unknown> = { '@id': id.startsWith('_:') ? id : shrink(id) };
        for (const [k, values] of Object.entries(props)) node[k] = values.length === 1 ? values[0] : values;
        return node;
    });

    return { '@context': context, '@graph': graph };
}
