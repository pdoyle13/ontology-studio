import { describe, it, expect } from 'vitest';
import { buildTaxonomyTree, type ConceptRow } from './skos';

const row = (iri: string, label: string, broader: string | null = null): ConceptRow => ({ iri, label, broader, deprecated: false });

describe('buildTaxonomyTree', () => {
  it('builds a sorted forest from broader links', () => {
    const tree = buildTaxonomyTree([
      row('c:z', 'Zeta'),
      row('c:a', 'Alpha'),
      row('c:a1', 'Alpha One', 'c:a'),
      row('c:a2', 'Alpha Two', 'c:a'),
      row('c:z1', 'Zeta One', 'c:z'),
    ]);
    expect(tree.map((n) => n.label)).toEqual(['Alpha', 'Zeta']);
    expect(tree[0].children.map((n) => n.label)).toEqual(['Alpha One', 'Alpha Two']);
    expect(tree[1].children).toHaveLength(1);
  });

  it('treats concepts with out-of-scheme broader as roots', () => {
    const tree = buildTaxonomyTree([row('c:x', 'X', 'c:not-here')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].iri).toBe('c:x');
  });

  it('breaks cycles instead of looping or dropping concepts', () => {
    const tree = buildTaxonomyTree([row('c:a', 'A', 'c:b'), row('c:b', 'B', 'c:a')]);
    const flat: string[] = [];
    const walk = (ns: typeof tree) => ns.forEach((n) => { flat.push(n.iri); walk(n.children); });
    walk(tree);
    expect(flat.sort()).toEqual(['c:a', 'c:b']);
    expect(tree.length).toBeGreaterThanOrEqual(1);
  });

  it('deep chains nest correctly', () => {
    const tree = buildTaxonomyTree([
      row('c:1', 'One'),
      row('c:2', 'Two', 'c:1'),
      row('c:3', 'Three', 'c:2'),
      row('c:4', 'Four', 'c:3'),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].children[0].children[0].label).toBe('Four');
  });
});
