import { describe, it, expect } from 'vitest';
import { buildSelect, mintSubject, planSources } from './federation.mjs';

const ENTRY = {
  classIri: 'https://studio.local/sql/sales_db#orders',
  sourceId: 'sales_db',
  table: 'orders',
  subjectTemplate: 'https://studio.local/sql/sales_db#orders/{id}',
  columns: [
    { column: 'id', property: 'p:id', datatype: 'xsd:integer' },
    { column: 'order_number', property: 'p:on', datatype: 'xsd:string' },
    { column: 'status', property: 'p:st', datatype: 'xsd:string' },
  ],
  refs: [],
};

describe('buildSelect', () => {
  it('selects mapped columns with guarded filters', () => {
    const sql = buildSelect(ENTRY, { columns: ['order_number'], filters: [{ column: 'status', op: '=', value: 'shipped' }], limit: 10 });
    expect(sql).toBe(`SELECT "order_number" FROM "orders" WHERE "status" = 'shipped' LIMIT 10`);
  });

  it('escapes string values', () => {
    const sql = buildSelect(ENTRY, { filters: [{ column: 'status', value: "x'; DROP TABLE orders;--" }] });
    expect(sql).toContain("'x''; DROP TABLE orders;--'");
    expect(sql).not.toContain("x'; DROP");
  });

  it('rejects unknown columns and operators', () => {
    expect(() => buildSelect(ENTRY, { filters: [{ column: 'evil', value: 1 }] })).toThrow(/unknown column/);
    expect(() => buildSelect(ENTRY, { filters: [{ column: 'status', op: 'UNION', value: 1 }] })).toThrow(/unsupported operator/);
    expect(() => buildSelect(ENTRY, { columns: ['nope'] })).toThrow(/no known columns/);
  });

  it('sorts and pages with guarded columns', () => {
    const sql = buildSelect(ENTRY, { orderBy: { column: 'status', dir: 'desc' }, limit: 50, offset: 100 });
    expect(sql).toContain('ORDER BY "status" DESC');
    expect(sql).toContain('LIMIT 50 OFFSET 100');
    expect(() => buildSelect(ENTRY, { orderBy: { column: 'evil' } })).toThrow(/unknown sort column/);
  });

  it('emits portable case-insensitive ILIKE', () => {
    const sql = buildSelect(ENTRY, { filters: [{ column: 'status', op: 'ILIKE', value: '%Turing%' }] });
    expect(sql).toContain(`LOWER("status") LIKE '%turing%'`);
  });

  it('caps the limit', () => {
    expect(buildSelect(ENTRY, { limit: 99999 })).toContain('LIMIT 1000');
    expect(buildSelect(ENTRY, {})).toContain('LIMIT 200');
  });

  // P1.2 — table/column names come from the writable R2RML catalog.
  it('neutralizes a hostile table name (identifier injection)', () => {
    const evil = { ...ENTRY, table: 'orders" ; DROP TABLE users; --' };
    const sql = buildSelect(evil, { columns: ['id'] });
    // the delimiter is doubled, so the payload stays inside the identifier
    expect(sql).toContain('FROM "orders"" ; DROP TABLE users; --"');
    expect(sql).not.toMatch(/FROM "orders" ;/);
  });

  it('rejects identifiers with control chars or backticks', () => {
    expect(() => buildSelect({ ...ENTRY, table: 'a`b' }, { columns: ['id'] })).toThrow(/illegal SQL identifier/);
  });
});

describe('mintSubject', () => {
  it('fills the R2RML template with URI-encoded values', () => {
    expect(mintSubject(ENTRY, { id: 7 })).toBe('https://studio.local/sql/sales_db#orders/7');
    expect(mintSubject(ENTRY, { id: 'a b' })).toBe('https://studio.local/sql/sales_db#orders/a%20b');
  });
});

describe('planSources', () => {
  it('groups requested classes by owning database', () => {
    const catalog = [
      ENTRY,
      { ...ENTRY, classIri: 'c:customers', sourceId: 'crm_db', table: 'customers' },
      { ...ENTRY, classIri: 'c:shipments', sourceId: 'shipping_db', table: 'shipments' },
    ];
    const plan = planSources(catalog, ['c:customers', 'c:shipments']);
    expect(plan).toHaveLength(2);
    expect(plan.map((p) => p.sourceId).sort()).toEqual(['crm_db', 'shipping_db']);
    expect(planSources(catalog, ['c:unknown'])).toHaveLength(0);
  });
});
