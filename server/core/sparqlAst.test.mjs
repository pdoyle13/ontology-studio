import { describe, it, expect } from 'vitest';
import { updateGraphTags } from './sparqlAst.mjs';

describe('updateGraphTags', () => {
    it('finds GRAPH blocks in INSERT DATA', () => {
        expect(updateGraphTags('INSERT DATA { GRAPH <https://g/one> { <https://x/a> <https://x/p> "v" } }')).toEqual([
            'https://g/one',
        ]);
    });

    it('finds multiple graphs across operations', () => {
        const tags = updateGraphTags(
            'DELETE DATA { GRAPH <https://g/a> { <https://x/s> <https://x/p> <https://x/o> } } ; INSERT DATA { GRAPH <https://g/b> { <https://x/s> <https://x/p> <https://x/o2> } }',
        );
        expect(tags.sort()).toEqual(['https://g/a', 'https://g/b']);
    });

    it('finds WITH-scoped updates', () => {
        const tags = updateGraphTags('WITH <https://g/w> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }');
        expect(tags).toContain('https://g/w');
    });

    it('finds GRAPH patterns inside WHERE-updates', () => {
        const tags = updateGraphTags(
            'DELETE { GRAPH <https://g/t> { ?s ?p ?o } } WHERE { GRAPH <https://g/t> { ?s ?p ?o FILTER(?o > 1) } }',
        );
        expect(tags).toEqual(['https://g/t']);
    });

    it('returns [] for default-graph updates', () => {
        expect(updateGraphTags('INSERT DATA { <https://x/a> <https://x/p> "v" }')).toEqual([]);
    });

    it('regex fallback still tags unparseable input', () => {
        expect(updateGraphTags('NOT SPARQL AT ALL GRAPH <https://g/fallback> {')).toEqual(['https://g/fallback']);
    });
});
