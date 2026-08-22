import { describe, it, expect } from 'vitest';
import { matchSubject } from './virtual.mjs';
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
