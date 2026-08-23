import { describe, it, expect, beforeEach } from 'vitest';
import { SearchIndex, tokenize, search } from './searchIndex.mjs';

let idx;
beforeEach(() => {
  idx = new SearchIndex();
  idx.add('c:1', { iri: 'c:1', kind: 'data', label: 'Alan Turing' }, { label: 'Alan Turing', text: 'Alan Turing ada@x.com London' });
  idx.add('c:2', { iri: 'c:2', kind: 'data', label: 'Grace Hopper' }, { label: 'Grace Hopper', text: 'Grace Hopper compilers' });
  idx.add('c:3', { iri: 'c:3', kind: 'model', label: 'Turing Award' }, { label: 'Turing Award', text: 'prize named after Turing' });
});

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumerics', () => {
    expect(tokenize('Wire-Transfers (SWIFT)!')).toEqual(['wire', 'transfers', 'swift']);
  });
});

describe('search: ES DSL', () => {
  it('multi_match ranks label matches above body matches', () => {
    const r = search(idx, { query: { multi_match: { query: 'turing', fields: ['label^3', 'text'] } } });
    expect(r.hits.total.value).toBe(2);
    expect(r.hits.hits.map((h) => h._id)).toContain('c:1');
    expect(r.hits.hits[0]._source.label).toMatch(/Turing/);
  });

  it('prefix-matches the last token as you type', () => {
    const r = search(idx, { query: { multi_match: { query: 'hopp', fields: ['label^3', 'text'] } } });
    expect(r.hits.hits[0]._id).toBe('c:2');
  });

  it('match_all + pagination', () => {
    const r = search(idx, { query: { match_all: {} }, from: 1, size: 1 });
    expect(r.hits.total.value).toBe(3);
    expect(r.hits.hits).toHaveLength(1);
  });

  it('term filters on stored source fields', () => {
    const r = search(idx, { query: { term: { kind: 'model' } } });
    expect(r.hits.hits.map((h) => h._id)).toEqual(['c:3']);
  });

  it('bool must + filter intersects, must_not excludes', () => {
    const r = search(idx, {
      query: { bool: { must: [{ match: { text: 'turing' } }], filter: [{ term: { kind: 'data' } }] } },
    });
    expect(r.hits.hits.map((h) => h._id)).toEqual(['c:1']);
    const r2 = search(idx, {
      query: { bool: { must: [{ match: { text: 'turing' } }], must_not: [{ term: { kind: 'model' } }] } },
    });
    expect(r2.hits.hits.map((h) => h._id)).toEqual(['c:1']);
  });

  it('remove() drops a doc from results', () => {
    idx.remove('c:1');
    const r = search(idx, { query: { match: { text: 'turing' } } });
    expect(r.hits.hits.map((h) => h._id)).toEqual(['c:3']);
  });

  it('responses carry the ES envelope', () => {
    const r = search(idx, { query: { match_all: {} } });
    expect(r).toHaveProperty('took');
    expect(r).toHaveProperty('_shards.successful', 1);
    expect(r.hits.hits[0]).toHaveProperty('_index', 'studio');
    expect(r.hits.hits[0]).toHaveProperty('_source.iri');
  });
});
