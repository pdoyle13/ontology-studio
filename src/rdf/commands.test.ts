import { describe, it, expect } from 'vitest';
import {
    buildCreateResource,
    buildCreateInstance,
    buildDeleteResource,
    buildRenameIri,
    buildSetDeprecated,
} from './commands';
import { InvalidIriError } from './term';

const G = 'https://studio.local/graphs/model';
const S = 'https://ex.org/Thing1';
const T = 'https://ex.org/Thing';
const BREAKOUT = 'https://x/a> ; DROP SILENT GRAPH <urn:t> ; INSERT DATA { <s';

describe('buildCreateResource', () => {
    it('builds inverse-paired INSERT/DELETE with a type and label', () => {
        const q = buildCreateResource(G, S, T, 'Widget');
        expect(q.insert).toContain(`GRAPH <${G}>`);
        expect(q.insert).toContain(`<${S}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${T}>`);
        expect(q.insert).toContain('"Widget"');
        expect(q.insert.replace('INSERT', '')).toBe(q.delete.replace('DELETE', ''));
    });
    it('omits the label triple when none given, and the graph wrapper in the default graph', () => {
        const q = buildCreateResource(null, S, T);
        expect(q.insert).not.toContain('GRAPH');
        expect(q.insert).not.toContain('rdf-schema#label');
    });
    it('rejects a breakout IRI in any position', () => {
        expect(() => buildCreateResource(G, BREAKOUT, T)).toThrow(InvalidIriError);
        expect(() => buildCreateResource(G, S, BREAKOUT)).toThrow(InvalidIriError);
        expect(() => buildCreateResource(BREAKOUT, S, T)).toThrow(InvalidIriError);
    });
});

describe('buildCreateInstance', () => {
    it('serializes IRI-valued and literal-valued props', () => {
        const q = buildCreateInstance(G, S, T, 'X', [
            { predicate: 'https://ex.org/rel', value: 'https://ex.org/Other', isIri: true },
            {
                predicate: 'https://ex.org/n',
                value: '5',
                isIri: false,
                datatype: 'http://www.w3.org/2001/XMLSchema#integer',
            },
        ]);
        expect(q.insert).toContain('<https://ex.org/Other>');
        expect(q.insert).toContain('"5"^^<http://www.w3.org/2001/XMLSchema#integer>');
    });
    it('rejects a hostile predicate IRI', () => {
        expect(() =>
            buildCreateInstance(G, S, T, undefined, [{ predicate: BREAKOUT, value: 'x', isIri: false }]),
        ).toThrow(InvalidIriError);
    });
});

describe('buildDeleteResource', () => {
    it('deletes outgoing only, or both directions', () => {
        expect(buildDeleteResource(G, S, false)).toBe(`DELETE WHERE { GRAPH <${G}> { <${S}> ?p ?o } }`);
        const both = buildDeleteResource(null, S, true);
        expect(both).toContain(`<${S}> ?p ?o`);
        expect(both).toContain(`?s ?p <${S}>`);
        expect(both).toContain(' ; ');
    });
    it('rejects a breakout IRI', () => {
        expect(() => buildDeleteResource(G, BREAKOUT, false)).toThrow(InvalidIriError);
    });
});

describe('buildRenameIri', () => {
    it('rewrites subject, predicate and object across default + named graphs', () => {
        const q = buildRenameIri(S, T);
        expect(q).toContain(`<${S}>`);
        expect(q).toContain(`<${T}>`);
        // six clauses joined by ' ;'
        expect(q.split(' ;').length).toBe(6);
    });
    it('rejects a breakout in either IRI', () => {
        expect(() => buildRenameIri(BREAKOUT, T)).toThrow(InvalidIriError);
        expect(() => buildRenameIri(S, BREAKOUT)).toThrow(InvalidIriError);
    });
});

describe('buildSetDeprecated', () => {
    it('produces add and delete forms', () => {
        const { add, del } = buildSetDeprecated(G, S);
        expect(add).toContain('INSERT DATA');
        expect(add).toContain('https://studio.local/ns#deprecated');
        expect(del).toContain('DELETE WHERE');
    });
    it('rejects a breakout IRI', () => {
        expect(() => buildSetDeprecated(G, BREAKOUT)).toThrow(InvalidIriError);
    });
});
