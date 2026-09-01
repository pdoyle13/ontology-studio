import { describe, it, expect } from 'vitest';
import { isSystemClass } from './queries';

describe('isSystemClass', () => {
    it('hides SKOS, SHACL, R2RML, PROV, OWL/RDF(S) machinery', () => {
        expect(isSystemClass('http://www.w3.org/2004/02/skos/core#Concept')).toBe(true);
        expect(isSystemClass('http://www.w3.org/2004/02/skos/core#ConceptScheme')).toBe(true);
        expect(isSystemClass('http://www.w3.org/ns/shacl#NodeShape')).toBe(true);
        expect(isSystemClass('http://www.w3.org/ns/r2rml#TriplesMap')).toBe(true);
        expect(isSystemClass('http://www.w3.org/ns/prov#Activity')).toBe(true);
    });

    it('hides studio bookkeeping classes by exact IRI', () => {
        for (const n of [
            'Change',
            'User',
            'Proposal',
            'Comment',
            'AssetType',
            'SavedQuery',
            'Dashboard',
            'QualityRun',
        ]) {
            expect(isSystemClass(`https://studio.local/ns#${n}`)).toBe(true);
        }
    });

    it('keeps domain and user-minted classes', () => {
        expect(isSystemClass('https://example.org/music#Album')).toBe(false);
        expect(isSystemClass('https://studio.local/sql/sales_db#orders')).toBe(false);
        expect(isSystemClass('https://studio.local/ns#DataDomains')).toBe(false); // custom asset type
        expect(isSystemClass('https://studio.local/ns#Glossary')).toBe(false); // built-in asset class users populate
        expect(isSystemClass('https://spec.edmcouncil.org/fibo/ontology/FND/Parties/Parties/Customer')).toBe(false);
    });
});
