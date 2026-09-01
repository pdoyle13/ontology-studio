import { describe, it, expect } from 'vitest';
import {
  sqlTypeToXsd,
  sane,
  classIri,
  propIri,
  escLit,
  isReadOnlySql,
  translateSchema,
  rowsToBlocks,
  humanize,
  pickLabelColumn,
  XSD,
  SH,
  DASH,
} from './translate.mjs';

const NS = 'https://studio.local/sql/test#';

const SCHEMA = [
  {
    name: 'artist',
    rowCount: 2,
    columns: [
      { name: 'id', type: 'INTEGER', notnull: true, pk: true },
      { name: 'name', type: 'TEXT', notnull: true, pk: false },
    ],
    fks: [],
  },
  {
    name: 'album',
    rowCount: 1,
    columns: [
      { name: 'id', type: 'INTEGER', notnull: true, pk: true },
      { name: 'title', type: 'TEXT', notnull: false, pk: false },
      { name: 'year', type: 'INT', notnull: false, pk: false },
      { name: 'artist_id', type: 'INTEGER', notnull: true, pk: false },
      { name: 'cover', type: 'BLOB', notnull: false, pk: false },
    ],
    fks: [{ from: 'artist_id', table: 'artist', to: 'id' }],
  },
];

describe('sqlTypeToXsd', () => {
  it('maps SQL affinities to xsd', () => {
    expect(sqlTypeToXsd('INTEGER')).toBe(`${XSD}integer`);
    expect(sqlTypeToXsd('BIGINT')).toBe(`${XSD}integer`);
    expect(sqlTypeToXsd('REAL')).toBe(`${XSD}decimal`);
    expect(sqlTypeToXsd('NUMERIC(10,2)')).toBe(`${XSD}decimal`);
    expect(sqlTypeToXsd('BOOLEAN')).toBe(`${XSD}boolean`);
    expect(sqlTypeToXsd('DATETIME')).toBe(`${XSD}dateTime`);
    expect(sqlTypeToXsd('TIMESTAMP')).toBe(`${XSD}dateTime`);
    expect(sqlTypeToXsd('DATE')).toBe(`${XSD}date`);
    expect(sqlTypeToXsd('VARCHAR(50)')).toBe(`${XSD}string`);
    expect(sqlTypeToXsd('')).toBe(`${XSD}string`);
    expect(sqlTypeToXsd('BLOB')).toBeNull();
  });
});

describe('naming + escaping', () => {
  it('sanitizes identifiers', () => {
    expect(sane('my table!')).toBe('my_table_');
    expect(classIri(NS, 'album')).toBe(`${NS}album`);
    expect(propIri(NS, 'album', 'artist id')).toBe(`${NS}album_artist_id`);
  });

  it('escapes literal content', () => {
    expect(escLit('a"b\\c\nd')).toBe('a\\"b\\\\c\\nd');
  });
});

describe('isReadOnlySql', () => {
  it('allows reads, blocks writes', () => {
    expect(isReadOnlySql('SELECT 1')).toBe(true);
    expect(isReadOnlySql('  with x as (select 1) select * from x')).toBe(true);
    expect(isReadOnlySql('PRAGMA table_info("t")')).toBe(true);
    expect(isReadOnlySql('DROP TABLE t')).toBe(false);
    expect(isReadOnlySql('INSERT INTO t VALUES (1)')).toBe(false);
    expect(isReadOnlySql('UPDATE t SET a=1')).toBe(false);
    expect(isReadOnlySql('')).toBe(false);
  });

  it('blocks the data-modifying CTE bypass (P1.3)', () => {
    expect(isReadOnlySql('WITH x AS (SELECT 1) DELETE FROM users')).toBe(false);
    expect(isReadOnlySql('WITH x AS (SELECT 1) UPDATE users SET admin = true')).toBe(false);
  });

  it('blocks multi-statement bodies but allows a trailing semicolon', () => {
    expect(isReadOnlySql('SELECT 1; DROP TABLE t')).toBe(false);
    expect(isReadOnlySql('SELECT 1; SELECT 2')).toBe(false);
    expect(isReadOnlySql('SELECT * FROM t WHERE x = 1;')).toBe(true);
  });

  it('does not false-positive on write keywords inside string literals', () => {
    expect(isReadOnlySql("SELECT 'DELETE FROM t' AS note")).toBe(true);
    expect(isReadOnlySql("SELECT * FROM t WHERE note = 'we will DROP soon'")).toBe(true);
  });
});

describe('translateSchema', () => {
  const nt = translateSchema(SCHEMA, NS);

  it('emits a class and a NodeShape per table', () => {
    expect(nt).toContain(`<${NS}artist> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2000/01/rdf-schema#Class> .`);
    expect(nt).toContain(`<${NS}albumShape> <${SH}targetClass> <${NS}album> .`);
  });

  it('NOT NULL and PK columns get minCount 1; every column maxCount 1', () => {
    expect(nt).toContain(`<${NS}artistShape-p-name> <${SH}minCount> "1"^^<${XSD}integer> .`);
    expect(nt).not.toContain(`<${NS}albumShape-p-title> <${SH}minCount>`);
    expect(nt).toContain(`<${NS}albumShape-p-title> <${SH}maxCount> "1"^^<${XSD}integer> .`);
  });

  it('FK columns become object properties with sh:class', () => {
    expect(nt).toContain(`<${NS}albumShape-p-artist_id> <${SH}class> <${NS}artist> .`);
    expect(nt).toContain(`<${NS}albumShape-p-artist_id> <${SH}nodeKind> <${SH}IRI> .`);
    expect(nt).not.toContain(`<${NS}albumShape-p-artist_id> <${SH}datatype>`);
  });

  it('BLOB columns get no datatype constraint', () => {
    expect(nt).not.toContain(`albumShape-p-cover> <${SH}datatype>`);
  });
});

describe('humanize', () => {
  it('turns identifiers into Title Case', () => {
    expect(humanize('delivery_events')).toBe('Delivery Events');
    expect(humanize('orderNumber')).toBe('Order Number');
    expect(humanize('tracking_no')).toBe('Tracking No');
    expect(humanize('id')).toBe('Id');
  });
});

describe('pickLabelColumn', () => {
  const table = (cols, fks = []) => ({ name: 't', rowCount: 0, columns: cols, fks });
  const col = (name, type = 'TEXT', pk = false) => ({ name, type, notnull: false, pk });

  it('prefers name/title columns', () => {
    expect(pickLabelColumn(table([col('id', 'INTEGER', true), col('name'), col('status')]))?.name).toBe('name');
  });

  it('falls back to business keys, then first text column', () => {
    expect(pickLabelColumn(table([col('id', 'INTEGER', true), col('order_number'), col('notes')]))?.name).toBe('order_number');
    expect(pickLabelColumn(table([col('id', 'INTEGER', true), col('notes')]))?.name).toBe('notes');
  });

  it('never picks an FK column', () => {
    const t = table([col('id', 'INTEGER', true), col('customer_name')], [{ from: 'customer_name', table: 'c', to: 'id' }]);
    expect(pickLabelColumn(t)).toBeNull();
  });
});

describe('dash:LabelRole designation (no fabricated labels)', () => {
  const nt = translateSchema(SCHEMA, NS);

  it('marks the label column property shape with dash:propertyRole dash:LabelRole', () => {
    expect(nt).toContain(`<${NS}artistShape-p-name> <${DASH}propertyRole> <${DASH}LabelRole> .`);
  });

  it('emits NO rdfs:label triples on instances', () => {
    const [block] = rowsToBlocks(
      [{ id: 7, title: 'OK Computer', year: 1997, artist_id: 3, cover: null }],
      SCHEMA[1],
      NS
    );
    expect(block).not.toContain('rdf-schema#label');
  });
});

describe('rowsToBlocks', () => {
  const info = SCHEMA[1]; // album

  it('mints subjects from the PK and types the row', () => {
    const [block] = rowsToBlocks([{ id: 7, title: 'OK Computer', year: 1997, artist_id: 3, cover: null }], info, NS);
    expect(block).toContain(`<${NS}album/7> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${NS}album> .`);
    expect(block).toContain(`<${NS}album/7> <${NS}album_title> "OK Computer" .`);
    expect(block).toContain(`<${NS}album/7> <${NS}album_year> "1997"^^<${XSD}integer> .`);
  });

  it('FK values become object IRIs of the target table', () => {
    const [block] = rowsToBlocks([{ id: 7, title: 't', year: null, artist_id: 3, cover: null }], info, NS);
    expect(block).toContain(`<${NS}album/7> <${NS}album_artist_id> <${NS}artist/3> .`);
  });

  it('skips NULLs and BLOBs', () => {
    const [block] = rowsToBlocks([{ id: 1, title: null, year: null, artist_id: 2, cover: 'xx' }], info, NS);
    expect(block).not.toContain('album_title');
    expect(block).not.toContain('album_cover');
  });

  it('falls back to rowid subjects without a PK', () => {
    const noPk = { name: 'log', rowCount: 1, columns: [{ name: 'msg', type: 'TEXT', notnull: false, pk: false }], fks: [] };
    const [block] = rowsToBlocks([{ __rowid: 42, msg: 'hi' }], noPk, NS);
    expect(block).toContain(`<${NS}log/42>`);
  });

  it('URI-encodes messy PK values', () => {
    const [block] = rowsToBlocks([{ id: 'a b/c', title: null, year: null, artist_id: null, cover: null }], info, NS);
    expect(block).toContain(`<${NS}album/a%20b%2Fc>`);
  });

  it('escapes literal content from rows', () => {
    const [block] = rowsToBlocks([{ id: 1, title: 'say "hi"\nok', year: null, artist_id: null, cover: null }], info, NS);
    expect(block).toContain('"say \\"hi\\"\\nok"');
  });
});
