import { describe, it, expect } from 'vitest';
import { extractParams, applyParams, queryIri } from './savedQueries';

describe('extractParams', () => {
    it('extracts unique placeholder names in first-seen order', () => {
        const q = 'SELECT * WHERE { ?s ?p "{{city}}" . FILTER(?y > {{year}}) . ?a ?b "{{city}}" }';
        expect(extractParams(q)).toEqual(['city', 'year']);
    });
    it('returns an empty list when there are no placeholders', () => {
        expect(extractParams('SELECT * WHERE { ?s ?p ?o }')).toEqual([]);
    });
});

describe('applyParams', () => {
    it('substitutes provided values and leaves missing/empty tokens intact', () => {
        expect(applyParams('x {{a}} y {{b}} z {{c}}', { a: '1', b: '' })).toBe('x 1 y {{b}} z {{c}}');
    });
    it('substitutes the same placeholder everywhere it appears', () => {
        expect(applyParams('{{n}}+{{n}}', { n: '2' })).toBe('2+2');
    });
});

describe('queryIri', () => {
    it('slugifies the title into a studio IRI', () => {
        expect(queryIri('  My Cool Query! ')).toBe('https://studio.local/query/my-cool-query');
    });
    it('falls back to "query" when the title has no slug characters', () => {
        expect(queryIri('***')).toBe('https://studio.local/query/query');
    });
});
