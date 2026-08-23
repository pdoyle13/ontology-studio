import { describe, it, expect } from 'vitest';
import { scoreCandidates, reconcileBatch, manifest } from './reconcile.mjs';

const hits = [
  { _id: 'a', _score: 8, _source: { label: 'Alan Turing', kind: 'data', type: 'row' } },
  { _id: 'b', _score: 4, _source: { label: 'Turing Award', kind: 'model', type: 'instance' } },
];

describe('scoreCandidates', () => {
  it('exact case-insensitive label match wins with 100/match', () => {
    const out = scoreCandidates('alan turing', hits);
    expect(out[0]).toMatchObject({ id: 'a', score: 100, match: true });
    expect(out[1].match).toBe(false);
    expect(out[1].score).toBeLessThanOrEqual(90);
  });

  it('non-exact queries scale by BM25', () => {
    const out = scoreCandidates('turing', hits);
    expect(out[0].id).toBe('a');
    expect(out[0].match).toBe(false);
    expect(out[0].score).toBe(90);
  });
});

describe('reconcileBatch', () => {
  it('runs each query through the search service', async () => {
    const svc = { search: async () => ({ hits: { hits } }) };
    const out = await reconcileBatch(svc, { q0: { query: 'Alan Turing', limit: 1 }, q1: { query: '' } });
    expect(out.q0.result).toHaveLength(1);
    expect(out.q1.result).toEqual([]);
  });
});

describe('manifest', () => {
  it('carries the reconciliation spec essentials', () => {
    const m = manifest('http://x');
    expect(m.versions).toContain('0.2');
    expect(m.identifierSpace).toBeTruthy();
    expect(m.view.url).toContain('{{id}}');
  });
});
