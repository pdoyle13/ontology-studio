// Import/export: client-side parse with n3 (validation + prefix discovery),
// chunked N-Triples upload via the Graph Store Protocol, prefixed Turtle export.

import { Parser, Writer, type Quad } from 'n3';
import type { Endpoint } from './sparqlClient';
import { SparqlError, construct } from './sparqlClient';

export interface ParseResult {
    quads: Quad[];
    prefixes: Record<string, string>;
}

/** Parse Turtle/N-Triples text. Throws with a line-anchored message on syntax errors. */
export function parseTurtle(text: string): ParseResult {
    const parser = new Parser();
    const prefixes: Record<string, string> = {};
    const quads = parser.parse(text, undefined, (prefix, iri) => {
        prefixes[prefix] = iri.value;
    }) as Quad[];
    return { quads, prefixes };
}

function quadsToNTriples(quads: Quad[]): string {
    const writer = new Writer({ format: 'N-Triples' });
    return writer.quadsToString(quads);
}

const CHUNK = 5000;

/** Upload parsed quads to a named graph in chunks. Reports progress in [0,1]. */
export async function importQuads(
    ep: Endpoint,
    graph: string | null,
    quads: Quad[],
    onProgress?: (done: number, total: number) => void,
): Promise<void> {
    if (!ep.storeUrl) throw new SparqlError('Endpoint has no Graph Store URL — bulk load unavailable');
    const url = graph ? `${ep.storeUrl}?graph=${encodeURIComponent(graph)}` : `${ep.storeUrl}?default`;
    for (let i = 0; i < quads.length; i += CHUNK) {
        const chunk = quads.slice(i, i + CHUNK);
        const body = quadsToNTriples(chunk);
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/n-triples' },
            body,
        });
        if (!res.ok)
            throw new SparqlError(`Chunk upload failed: ${res.status}`, res.status, await res.text().catch(() => ''));
        onProgress?.(Math.min(i + CHUNK, quads.length), quads.length);
    }
}

/** Fetch RDF from a URL (content-negotiated toward Turtle). Subject to CORS. */
export async function fetchRdfFromUrl(url: string): Promise<string> {
    const res = await fetch(url, {
        headers: { Accept: 'text/turtle, application/n-triples;q=0.9, application/rdf+xml;q=0.3, */*;q=0.1' },
    });
    if (!res.ok) throw new SparqlError(`Fetch failed: ${res.status} ${res.statusText}`, res.status);
    const ct = res.headers.get('content-type') ?? '';
    const text = await res.text();
    if (ct.includes('rdf+xml') || text.trimStart().startsWith('<?xml'))
        throw new SparqlError('Source returned RDF/XML — not supported yet (Turtle/N-Triples only)');
    return text;
}

/** Export a graph as prefixed Turtle (round-trip through n3 for clean serialization). */
export async function exportGraphTurtle(
    ep: Endpoint,
    graph: string | null,
    prefixes: Record<string, string>,
): Promise<string> {
    const q = graph
        ? `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${graph}> { ?s ?p ?o } }`
        : `CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }`;
    const raw = await construct(ep, q);
    const { quads } = parseTurtle(raw);
    return new Promise((resolve, reject) => {
        const writer = new Writer({ prefixes });
        writer.addQuads(quads);
        writer.end((err, result) => (err ? reject(err) : resolve(result)));
    });
}

/** Export a graph as flat JSON-LD. */
export async function exportGraphJsonLd(
    ep: Endpoint,
    graph: string | null,
    prefixes: { shrink: (iri: string) => string; entries: () => Record<string, string> },
): Promise<string> {
    const q = graph
        ? `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${graph}> { ?s ?p ?o } }`
        : `CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }`;
    const raw = await construct(ep, q);
    const { quads } = parseTurtle(raw);
    const { quadsToJsonLd } = await import('./jsonld');
    return JSON.stringify(quadsToJsonLd(quads, prefixes), null, 2);
}

export function downloadText(filename: string, text: string) {
    const blob = new Blob([text], { type: 'text/turtle;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}
