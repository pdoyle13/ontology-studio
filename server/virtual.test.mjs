import { describe, it, expect } from 'vitest';
import { matchSubject, virtualSearch } from './virtual.mjs';
import { QueryCache } from './cache.mjs';

const CATALOG = [
  {
    classIri: 'https://studio.local/sql/sales_db#orders',
    sourceId: 'sales_db',
    table: 'orders',
    subjectTemplate: 'https://studio.local/sql/sales_db#orders/{id}',
    columns: [{ column: 'id', property: 'p:id', datatype: null }],
    refs: [],
  },
  {
    classIri: 'https://studio.local/sql/crm_db#customers',
    sourceId: 'crm_db',
    table: 'customers',
    subjectTemplate: 'https://studio.local/sql/crm_db#customers/{id}',
    columns: [{ column: 'id', property: 'p:cid', datatype: null }],
    refs: [],
  },
];

describe('matchSubject', () => {
  it('resolves a virtual IRI to its catalog entry and key filters', () => {
    const m = matchSubject(CATALOG, 'https://studio.local/sql/sales_db#orders/42');
    expect(m?.entry.sourceId).toBe('sales_db');
    expect(m?.filters).toEqual([{ column: 'id', op: '=', value: '42' }]);
  });

  it('decodes URI-encoded key values', () => {
    const m = matchSubject(CATALOG, 'https://studio.local/sql/sales_db#orders/a%20b');
    expect(m?.filters[0].value).toBe('a b');
  });

  it('distinguishes classes by template', () => {
    expect(matchSubject(CATALOG, 'https://studio.local/sql/crm_db#customers/7')?.entry.table).toBe('customers');
  });

  it('rejects non-virtual IRIs', () => {
    expect(matchSubject(CATALOG, 'https://example.org/music#OKComputer')).toBeNull();
    expect(matchSubject(CATALOG, 'https://studio.local/sql/sales_db#orders')).toBeNull();
  });
});

describe('tag-scoped invalidation', () => {
  const entry = { status: 200, contentType: 'x', body: 'r' };

  it('evicts only entries tagged with an invalidated graph', () => {
    const c = new QueryCache();
    c.set('u', 'q1', entry, ['graph:A']);
    c.set('u', 'q2', entry, ['graph:B']);
    c.invalidate(['graph:A']);
    expect(c.get('u', 'q1')).toBeNull();
    expect(c.get('u', 'q2')).not.toBeNull();
  });

  it('star-tagged entries fall on any scoped invalidation', () => {
    const c = new QueryCache();
    c.set('u', 'global', entry, ['*']);
    c.set('u', 'scoped', entry, ['graph:B']);
    c.invalidate(['graph:A']);
    expect(c.get('u', 'global')).toBeNull(); // depends on everything
    expect(c.get('u', 'scoped')).not.toBeNull();
  });

  it('untagged invalidation clears everything', () => {
    const c = new QueryCache();
    c.set('u', 'a', entry, ['graph:A']);
    c.set('u', 'b', entry, ['graph:B']);
    c.invalidate();
    expect(c.get('u', 'a')).toBeNull();
    expect(c.get('u', 'b')).toBeNull();
  });

  it('listeners receive the invalidation tags', () => {
    const c = new QueryCache();
    let seen = 'unset';
    c.onInvalidate((tags) => { seen = tags; });
    c.set('u', 'a', entry, ['graph:A']);
    c.invalidate(['graph:A']);
    expect(seen).toEqual(['graph:A']);
  });
});

describe('virtualSearch', () => {
  const catalog = [
    {
      ...CATALOG[0],
      columns: [
        { column: 'id', property: 'p:id', datatype: null },
        { column: 'order_number', property: 'https://p/on', datatype: null },
      ],
    },
    { ...CATALOG[1] }, // no label column -> skipped
  ];
  const labelProps = new Set(['https://p/on']);

  it('fans label-column LIKE queries across sources and mints IRIs', async () => {
    const seen = [];
    const drivers = new Map([
      ['sales_db', { query: async (sql) => { seen.push(sql); return [{ id: 9, order_number: 'ORD-1009' }]; } }],
      ['crm_db', { query: async () => { throw new Error('should not be queried'); } }],
    ]);
    const out = await virtualSearch({ catalog, drivers, text: '1009', labelProps });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("LIKE '%1009%'");
    expect(out).toEqual([
      { iri: 'https://studio.local/sql/sales_db#orders/9', label: 'ORD-1009', classIri: catalog[0].classIri, sourceId: 'sales_db' },
    ]);
  });

  it('swallows per-source failures instead of failing the whole search', async () => {
    const lp = new Set(['https://p/on', 'p:cid']);
    const cat2 = [catalog[0], { ...CATALOG[1], columns: [{ column: 'id', property: 'p:cid', datatype: null }] }];
    const drivers = new Map([
      ['sales_db', { query: async () => [{ id: 1, order_number: 'ORD-1001' }] }],
      ['crm_db', { query: async () => { throw new Error('db down'); } }],
    ]);
    const out = await virtualSearch({ catalog: cat2, drivers, text: '100', labelProps: lp });
    expect(out).toHaveLength(1);
    expect(out[0].sourceId).toBe('sales_db');
  });
});
