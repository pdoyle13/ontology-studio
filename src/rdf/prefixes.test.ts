import { describe, it, expect } from 'vitest';
import { PrefixMap, localName, DEFAULT_PREFIXES } from './prefixes';

describe('PrefixMap', () => {
    it('shrinks known namespaces to curies', () => {
        const p = new PrefixMap();
        expect(p.shrink('http://www.w3.org/2000/01/rdf-schema#label')).toBe('rdfs:label');
        expect(p.shrink('http://www.w3.org/ns/shacl#NodeShape')).toBe('sh:NodeShape');
    });

    it('leaves unknown IRIs untouched', () => {
        const p = new PrefixMap();
        expect(p.shrink('https://nowhere.example/x#Thing')).toBe('https://nowhere.example/x#Thing');
    });

    it('prefers the longest matching namespace', () => {
        const p = new PrefixMap({ a: 'http://x.org/', ab: 'http://x.org/deep/' });
        expect(p.shrink('http://x.org/deep/Thing')).toBe('ab:Thing');
        expect(p.shrink('http://x.org/Thing')).toBe('a:Thing');
    });

    it('does not shrink when the local name is not curie-safe', () => {
        const p = new PrefixMap();
        const iri = 'http://www.w3.org/2000/01/rdf-schema#has/slash';
        expect(p.shrink(iri)).toBe(iri);
    });

    it('expands curies and passes through full IRIs', () => {
        const p = new PrefixMap();
        expect(p.expand('rdfs:label')).toBe('http://www.w3.org/2000/01/rdf-schema#label');
        expect(p.expand('http://x.org/a')).toBe('http://x.org/a');
        expect(p.expand('unknown:thing')).toBe('unknown:thing');
    });

    it('register is first-write-wins', () => {
        const p = new PrefixMap();
        p.register('ex', 'http://one.example/');
        p.register('ex', 'http://two.example/');
        expect(p.expand('ex:a')).toBe('http://one.example/a');
    });

    describe('learnNamespace', () => {
        it('learns a namespace with a generated prefix', () => {
            const p = new PrefixMap({});
            p.learnNamespace('https://data.acme.com/music#Album');
            expect(p.shrink('https://data.acme.com/music#Track')).toBe('music:Track');
        });

        it('skips namespaces already registered', () => {
            const p = new PrefixMap();
            p.learnNamespace('http://www.w3.org/2000/01/rdf-schema#Class');
            expect(p.shrink('http://www.w3.org/2000/01/rdf-schema#Class')).toBe('rdfs:Class');
        });

        it('dedupes generated prefixes with a counter', () => {
            const p = new PrefixMap({});
            p.learnNamespace('https://one.example/music#A');
            p.learnNamespace('https://two.example/music/B');
            expect(p.shrink('https://one.example/music#A')).toBe('music:A');
            expect(p.shrink('https://two.example/music/B')).toBe('music2:B');
        });

        it('ignores junk-short namespaces', () => {
            const p = new PrefixMap({});
            p.learnNamespace('urn:x:y');
            expect(p.entries()).toEqual({});
        });
    });

    it('sparqlPreamble emits one PREFIX line per entry', () => {
        const p = new PrefixMap({ ex: 'http://ex.org/' });
        expect(p.sparqlPreamble()).toBe('PREFIX ex: <http://ex.org/>');
    });

    it('default set covers the working vocabularies', () => {
        for (const k of ['rdf', 'rdfs', 'owl', 'sh', 'xsd', 'skos', 'dash']) {
            expect(DEFAULT_PREFIXES[k]).toBeTruthy();
        }
    });
});

describe('localName', () => {
    it('takes the fragment or last path segment', () => {
        expect(localName('http://x.org/a#B')).toBe('B');
        expect(localName('http://x.org/a/b/C')).toBe('C');
        expect(localName('http://x.org/a%20b')).toBe('a b');
    });
});
