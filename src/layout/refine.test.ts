import { describe, it, expect } from 'vitest';
import { refineBySwaps, compact } from './refine';
import { measureLayout } from './metrics';
import type { LayoutEdge, LayoutNode, Positions } from './types';

const nodes: LayoutNode[] = [
    { id: 'a', w: 40, h: 20 },
    { id: 'b', w: 40, h: 20 },
    { id: 'c', w: 40, h: 20 },
    { id: 'd', w: 40, h: 20 },
] as LayoutNode[];

// a-c and b-d are crossing diagonals; swapping c and d uncrosses them.
const crossing: Positions = new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 0, y: 200 }],
    ['c', { x: 200, y: 200 }],
    ['d', { x: 200, y: 0 }],
]);
const edges: LayoutEdge[] = [
    { source: 'a', target: 'c' },
    { source: 'b', target: 'd' },
] as LayoutEdge[];

describe('refineBySwaps', () => {
    it('never increases crossings and resolves a fixable one', () => {
        const before = measureLayout(new Map(crossing), edges, nodes).crossings;
        expect(before).toBe(1);
        const after = measureLayout(refineBySwaps(new Map(crossing), edges, nodes), edges, nodes).crossings;
        expect(after).toBeLessThanOrEqual(before);
        expect(after).toBe(0);
    });

    it('is a no-op below three nodes or two edges', () => {
        const two = new Map([
            ['a', { x: 0, y: 0 }],
            ['b', { x: 10, y: 10 }],
        ]);
        expect(refineBySwaps(two, edges, nodes.slice(0, 2))).toBe(two);
    });

    it('is deterministic (fixed seed)', () => {
        const r1 = refineBySwaps(new Map(crossing), edges, nodes);
        const r2 = refineBySwaps(new Map(crossing), edges, nodes);
        for (const n of nodes) expect(r1.get(n.id)).toEqual(r2.get(n.id));
    });
});

describe('compact', () => {
    it('shrinks the footprint without introducing overlaps', () => {
        const spread: Positions = new Map([
            ['a', { x: 0, y: 0 }],
            ['b', { x: 600, y: 0 }],
            ['c', { x: 0, y: 600 }],
            ['d', { x: 600, y: 600 }],
        ]);
        const areaBefore = measureLayout(spread, [] as LayoutEdge[], nodes).area;
        const out = compact(spread, nodes);
        const after = measureLayout(out, [] as LayoutEdge[], nodes);
        expect(after.area).toBeLessThanOrEqual(areaBefore);
        expect(after.overlaps).toBe(0);
    });

    it('is a no-op for a single node', () => {
        const one = new Map([['a', { x: 5, y: 5 }]]);
        expect(compact(one, nodes.slice(0, 1))).toBe(one);
    });
});
