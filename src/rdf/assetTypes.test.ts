import { describe, it, expect } from 'vitest';
import { builtinAssetTypes } from './assetTypes';

describe('builtinAssetTypes', () => {
    const types = builtinAssetTypes();

    it('returns the five built-in asset types', () => {
        expect(types).toHaveLength(5);
        expect(types.map((t) => t.label)).toEqual([
            'Taxonomies',
            'Business glossaries',
            'Business objects',
            'Physical objects',
            'Mappings',
        ]);
    });

    it('marks every built-in as builtin with a stable slugged IRI and ascending order', () => {
        types.forEach((t, i) => {
            expect(t.builtin).toBe(true);
            expect(t.order).toBe(i + 1);
            expect(t.iri).toMatch(/^https:\/\/studio\.local\/ns#assetType\//);
            expect(t.classIri).toBeTruthy();
            expect(t.description).toBeTruthy();
        });
    });

    it('uses the documented presentation per type', () => {
        const byLabel = Object.fromEntries(types.map((t) => [t.label, t.presentation]));
        expect(byLabel['Taxonomies']).toBe('tree');
        expect(byLabel['Business glossaries']).toBe('list');
        expect(byLabel['Business objects']).toBe('catalog');
    });
});
