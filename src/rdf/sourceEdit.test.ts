import { describe, it, expect } from 'vitest';
import { computeSourceDiff, quadToNT, stripPrefixesToSparql } from './sourceEdit';
import { Parser } from 'n3';

const OLD = `
@prefix ex: <https://x/> .
ex:a ex:name "Alpha" .
ex:a ex:size "5"^^<http://www.w3.org/2001/XMLSchema#integer> .
ex:b ex:name "Beta"@de .
`;

describe('computeSourceDiff', () => {
    it('detects added and removed triples, ignores reordering/formatting', () => {
        const NEW = `
@prefix ex: <https://x/> .
ex:b   ex:name "Beta"@de .
ex:a ex:name "Alpha" .
ex:c ex:name "Gamma" .
`;
        const d = computeSourceDiff(OLD, NEW);
        expect(d.mode).toBe('diff');
        expect(d.added).toEqual(['<https://x/c> <https://x/name> "Gamma" .']);
        expect(d.removed).toEqual(['<https://x/a> <https://x/size> "5"^^<http://www.w3.org/2001/XMLSchema#integer> .']);
    });

    it('no-op edits produce an empty diff', () => {
        const d = computeSourceDiff(OLD, OLD.replace('"Alpha"', '"Alpha"'));
        expect(d.added).toEqual([]);
        expect(d.removed).toEqual([]);
    });

    it('RDF 1.2 quoted-triple syntax switches to replace mode', () => {
        const NEW = `<https://x/a> <https://x/name> "Alpha" .\n<< <https://x/a> <https://x/name> "Alpha" >> <https://x/certainty> "0.9" .`;
        const d = computeSourceDiff(OLD, NEW);
        expect(d.mode).toBe('replace');
        expect(d.newSource).toBe(NEW);
    });

    it('parse errors throw with a message', () => {
        expect(() => computeSourceDiff(OLD, 'this is not turtle @@')).toThrow();
    });
});

describe('quadToNT', () => {
    it('serializes IRIs, typed and language literals canonically', () => {
        const quads = new Parser().parse(OLD);
        const lines = quads.map(quadToNT);
        expect(lines).toContain('<https://x/b> <https://x/name> "Beta"@de .');
        expect(lines).toContain('<https://x/a> <https://x/size> "5"^^<http://www.w3.org/2001/XMLSchema#integer> .');
    });

    it('escapes quotes and newlines', () => {
        const q = new Parser().parse('<https://x/a> <https://x/p> "he said \\"hi\\"\\nbye" .');
        expect(quadToNT(q[0])).toBe('<https://x/a> <https://x/p> "he said \\"hi\\"\\nbye" .');
    });
});

describe('stripPrefixesToSparql', () => {
    it('drops @prefix/@base lines only', () => {
        const out = stripPrefixesToSparql(
            '@prefix ex: <https://x/> .\n@base <https://y/> .\n<https://x/a> <https://x/p> "v" .',
        );
        expect(out.trim()).toBe('<https://x/a> <https://x/p> "v" .');
    });
});

describe('blank-node handling', () => {
    const BN = `
<https://x/S> <https://x/prop> _:list0 .
_:list0 <https://x/first> "a" .
<https://x/S2> <https://x/shape> [ <https://x/name> "anon" ] .
<https://x/plain> <https://x/name> "keep" .
`;

    it('unchanged bnodes diff to empty despite global n3 labeling', () => {
        const d = computeSourceDiff(BN, BN + '\n');
        expect(d.mode).toBe('diff');
        expect(d.added).toEqual([]);
        expect(d.removed).toEqual([]);
    });

    it('plain-triple edits stay in diff mode even alongside bnodes', () => {
        const d = computeSourceDiff(BN, BN.replace('"keep"', '"kept"'));
        expect(d.mode).toBe('diff');
        expect(d.added).toEqual(['<https://x/plain> <https://x/name> "kept" .']);
    });

    it('bnode-touching edits switch to replace mode', () => {
        const d = computeSourceDiff(BN, BN.replace('"anon"', '"renamed"'));
        expect(d.mode).toBe('replace');
    });
});
