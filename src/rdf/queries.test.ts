import { describe, it, expect } from 'vitest';
import { scoped, labelPattern, isSystemClass } from './queries';

describe('scoped', () => {
    it('wraps in a single GRAPH block when a graph is given', () => {
        expect(scoped('?s ?p ?o', 'https://g/1')).toBe('GRAPH <https://g/1> { ?s ?p ?o }');
    });
    it('unions the default graph and all named graphs when none is given', () => {
        const q = scoped('?s ?p ?o', null);
        expect(q).toContain('UNION');
        expect(q).toContain('GRAPH ?__g');
        expect(q).toContain('?s ?p ?o');
    });
});

describe('labelPattern', () => {
    it('binds rdfs:label or the DASH label-role property, with unique helper vars', () => {
        const p = labelPattern('?x', 'lbl', 'A');
        expect(p).toContain('?__rlA');
        expect(p).toContain('AS ?lbl');
        expect(p).toContain('dash#LabelRole');
        // suffix keeps a second usage's helper vars distinct
        expect(labelPattern('?y', 'lbl2', 'B')).toContain('?__rlB');
    });
});

describe('isSystemClass', () => {
    it('flags studio-internal classes', () => {
        expect(isSystemClass('https://studio.local/ns#User')).toBe(true);
        expect(isSystemClass('https://studio.local/ns#Proposal')).toBe(true);
    });
    it('does not flag ordinary domain classes', () => {
        expect(isSystemClass('https://ex.org/model#Person')).toBe(false);
    });
});
