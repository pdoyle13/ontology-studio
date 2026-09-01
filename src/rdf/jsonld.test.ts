import { describe, it, expect } from 'vitest';
import { Parser } from 'n3';
import { quadsToJsonLd } from './jsonld';

const prefixes = {
    shrink: (iri: string) =>
        iri
            .replace('https://example.org/music#', 'mus:')
            .replace('http://www.w3.org/2001/XMLSchema#', 'xsd:')
            .replace('http://www.w3.org/2000/01/rdf-schema#', 'rdfs:'),
    entries: () => ({
        mus: 'https://example.org/music#',
        xsd: 'http://www.w3.org/2001/XMLSchema#',
        rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
        unused: 'https://nope/',
    }),
};

const TTL = `
@prefix mus: <https://example.org/music#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
mus:KidA a mus:Album ;
  mus:title "Kid A" ;
  mus:year "2000"^^xsd:integer ;
  mus:motto "Alles"@de ;
  mus:artist mus:Radiohead .
`;

describe('quadsToJsonLd', () => {
    const doc = quadsToJsonLd(new Parser().parse(TTL), prefixes) as {
        '@context': Record<string, string>;
        '@graph': Record<string, unknown>[];
    };
    const node = doc['@graph'].find((n) => n['@id'] === 'mus:KidA')!;

    it('groups per subject with @type and compacted keys', () => {
        expect(node['@type']).toBe('mus:Album');
        expect(node['mus:title']).toBe('Kid A');
        expect(node['mus:artist']).toEqual({ '@id': 'mus:Radiohead' });
    });

    it('typed and language literals use expanded value objects', () => {
        expect(node['mus:year']).toEqual({ '@value': '2000', '@type': 'xsd:integer' });
        expect(node['mus:motto']).toEqual({ '@value': 'Alles', '@language': 'de' });
    });

    it('@context carries only used prefixes', () => {
        expect(doc['@context'].mus).toBeTruthy();
        expect(doc['@context'].unused).toBeUndefined();
    });
});
