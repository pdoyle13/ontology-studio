import { describe, it, expect } from 'vitest';
import { layout, LAYOUTS, measureLayout, bestAnchorPair } from './index';
import type { LayoutEdge, LayoutNode } from './types';

const node = (id: string, x = 0, y = 0): LayoutNode => ({ id, w: 180, h: 52, x, y });
const edge = (source: string, target: string): LayoutEdge => ({ source, target });

describe('measureLayout', () => {
    it('detects an X crossing between independent edges', () => {
        const nodes = [node('a', 0, 0), node('b', 400, 400), node('c', 400, 0), node('d', 0, 400)];
        const pos = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
        const m = measureLayout(pos, [edge('a', 'b'), edge('c', 'd')], nodes);
        expect(m.crossings).toBe(1);
    });

    it('does not count edges sharing a node as crossing', () => {
        const nodes = [node('a', 0, 0), node('b', 400, 0), node('c', 200, 300)];
        const pos = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
        const m = measureLayout(pos, [edge('a', 'b'), edge('a', 'c'), edge('b', 'c')], nodes);
        expect(m.crossings).toBe(0);
    });

    it('counts overlapping nodes using their real sizes', () => {
        const nodes = [node('a', 0, 0), node('b', 20, 10), node('c', 900, 900)];
        const pos = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
        const m = measureLayout(pos, [], nodes);
        expect(m.overlaps).toBe(1);
    });
});

describe('layout engine', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => node(id, i * 50, i * 30));
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'e'), edge('c', 'f')];

    it('every algorithm positions every node', () => {
        for (const { id } of LAYOUTS) {
            const r = layout(id, nodes, edges);
            for (const n of nodes) expect(r.positions.has(n.id), `${id} lost ${n.id}`).toBe(true);
        }
    });

    it('auto produces zero crossings and zero overlaps on a tree', () => {
        const r = layout('auto', nodes, edges);
        expect(r.metrics.crossings).toBe(0);
        expect(r.metrics.overlaps).toBe(0);
    });

    it('auto is deterministic', () => {
        const a = layout('auto', nodes, edges);
        const b = layout('auto', nodes, edges);
        for (const n of nodes) expect(a.positions.get(n.id)).toEqual(b.positions.get(n.id));
        expect(a.picked).toBe(b.picked);
    });

    it('auto never scores worse than the plain candidates', () => {
        const autoCost = layout('auto', nodes, edges).metrics.cost;
        for (const algo of ['tree-lr', 'tree-tb', 'force', 'radial', 'circle', 'grid'] as const) {
            expect(autoCost).toBeLessThanOrEqual(layout(algo, nodes, edges).metrics.cost + 1e-6);
        }
    });

    it('reports which candidate won', () => {
        expect(layout('auto', nodes, edges).picked).toBeTruthy();
        expect(layout('grid', nodes, edges).picked).toBe('grid');
    });

    it('handles the empty graph', () => {
        const r = layout('auto', [], []);
        expect(r.positions.size).toBe(0);
    });
});

describe('bestAnchorPair', () => {
    it('picks facing side midpoints for horizontal neighbors', () => {
        const { from, to } = bestAnchorPair({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 0, w: 100, h: 50 });
        expect(from).toEqual({ x: 100, y: 25 }); // right of A
        expect(to).toEqual({ x: 300, y: 25 }); // left of B
    });

    it('picks top/bottom for vertical neighbors', () => {
        const { from, to } = bestAnchorPair({ x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 300, w: 100, h: 50 });
        expect(from).toEqual({ x: 50, y: 50 }); // bottom of A
        expect(to).toEqual({ x: 50, y: 300 }); // top of B
    });
});
