import { describe, it, expect } from 'vitest';
import { segsIntersect, measureLayout, NODE_MARGIN } from './metrics';
import type { LayoutNode, Positions } from './types';

const P = (x: number, y: number) => ({ x, y });

describe('segsIntersect', () => {
    it('detects a proper X crossing', () => {
        expect(segsIntersect(P(0, 0), P(10, 10), P(0, 10), P(10, 0))).toBe(true);
    });

    it('returns false for parallel and for disjoint segments', () => {
        expect(segsIntersect(P(0, 0), P(10, 0), P(0, 5), P(10, 5))).toBe(false); // parallel
        expect(segsIntersect(P(0, 0), P(1, 1), P(5, 5), P(6, 6))).toBe(false); // apart, collinear
        expect(segsIntersect(P(0, 0), P(1, 0), P(2, 2), P(3, 3))).toBe(false); // apart
    });

    it('treats a shared endpoint as NOT a crossing (guards on collinearity)', () => {
        expect(segsIntersect(P(0, 0), P(10, 10), P(0, 0), P(10, -10))).toBe(false);
    });

    it('treats a T-junction (endpoint touching the interior) as NOT a crossing', () => {
        // (5,5) lies on the first segment's interior — touching, not crossing
        expect(segsIntersect(P(0, 0), P(10, 10), P(5, 5), P(9, 0))).toBe(false);
    });
});

describe('measureLayout cost', () => {
    const nodes: LayoutNode[] = [
        { id: 'a', w: 40, h: 20 },
        { id: 'b', w: 40, h: 20 },
        { id: 'c', w: 40, h: 20 },
        { id: 'd', w: 40, h: 20 },
    ] as LayoutNode[];

    it('charges a crossing far more than a clean layout', () => {
        // clean: two vertical, non-crossing edges
        const clean: Positions = new Map([
            ['a', P(0, 0)],
            ['b', P(0, 200)],
            ['c', P(200, 0)],
            ['d', P(200, 200)],
        ]);
        // crossed: swap targets so a-d and c-b cross
        const crossed: Positions = new Map([
            ['a', P(0, 0)],
            ['b', P(200, 200)],
            ['c', P(200, 0)],
            ['d', P(0, 200)],
        ]);
        const edges = [
            { source: 'a', target: 'b' },
            { source: 'c', target: 'd' },
        ] as never[];
        const mClean = measureLayout(clean, edges, nodes);
        const mCross = measureLayout(crossed, edges, nodes);
        expect(mClean.crossings).toBe(0);
        expect(mCross.crossings).toBe(1);
        expect(mCross.cost).toBeGreaterThan(mClean.cost + 500);
    });

    it('counts overlapping nodes within the margin', () => {
        const pos: Positions = new Map([
            ['a', P(0, 0)],
            ['b', P(NODE_MARGIN / 2, 0)], // well within (a.w+b.w)/2 + margin
            ['c', P(1000, 1000)],
            ['d', P(2000, 2000)],
        ]);
        expect(measureLayout(pos, [] as never[], nodes).overlaps).toBeGreaterThanOrEqual(1);
    });
});
