import { describe, it, expect } from 'vitest';
import { emitR2rml, emitSyncProvenance, MAPPINGS_GRAPH, STUDIO } from './r2rml.mjs';
import { classIri, propIri, sqlTypeToXsd } from './translate.mjs';

const RR = 'http://www.w3.org/ns/r2rml#';
const NS = 'https://studio.local/sql/test#';
const NOW = '2026-08-22T15:00:00.000Z';

const SCHEMA = [
  {
    name: 'album',
    rowCount: 1,
    columns: [
      { name: 'id', type: 'INTEGER', notnull: true, pk: true },
      { name: 'title', type: 'TEXT', notnull: false, pk: false },
      { name: 'artist_id', type: 'INTEGER', notnull: true, pk: false },
    ],
    fks: [{ from: 'artist_id', table: 'artist', to: 'id' }],
  },
];

const emit = () =>
  emitR2rml({
    sourceId: 'test',
    schema: SCHEMA,
    ns: NS,
    classIriFn: classIri,
    propIriFn: propIri,
    xsdFn: sqlTypeToXsd,
    nowIso: NOW,
  });

describe('emitR2rml', () => {
  const nt = emit();

  it('emits a TriplesMap with logical table and subject template from the PK', () => {
    expect(nt).toContain(`<${RR}TriplesMap>`);
    expect(nt).toContain(`<${RR}tableName> "album" .`);
    expect(nt).toContain(`<${RR}template> "${NS}album/{id}" .`);
    expect(nt).toContain(`<${RR}class> <${NS}album> .`);
  });

  it('column maps carry rr:column + rr:datatype; FK maps carry IRI templates', () => {
    expect(nt).toContain(`<${RR}column> "title" .`);
    expect(nt).toContain('<http://www.w3.org/2001/XMLSchema#string>');
    expect(nt).toContain(`<${RR}template> "${NS}artist/{artist_id}" .`);
    expect(nt).toContain(`<${RR}termType> <${RR}IRI> .`);
  });

  it('records the source with a modification timestamp', () => {
    expect(nt).toContain(`<${STUDIO}source/test>`);
    expect(nt).toContain(NOW);
  });

  it('is valid N-Triples shaped (every line ends with a dot)', () => {
    for (const line of nt.split('\n')) expect(line.trim()).toMatch(/ \.$/);
  });
});

describe('emitSyncProvenance', () => {
  it('emits a prov:Activity linking source, graph, and counts', () => {
    const nt = emitSyncProvenance({
      sourceId: 'test',
      table: 'album',
      dataGraph: 'https://g.example/data',
      rows: 10,
      triples: 55,
      nowIso: NOW,
    });
    expect(nt).toContain('<http://www.w3.org/ns/prov#Activity>');
    expect(nt).toContain('<https://g.example/data>');
    expect(nt).toContain(`"10"^^<http://www.w3.org/2001/XMLSchema#integer>`);
    expect(nt).toContain(`"55"^^<http://www.w3.org/2001/XMLSchema#integer>`);
    expect(nt).toContain('wasDerivedFrom');
  });
});

describe('constants', () => {
  it('mappings graph IRI is stable', () => {
    expect(MAPPINGS_GRAPH).toBe('https://studio.local/graphs/mappings');
  });
});
