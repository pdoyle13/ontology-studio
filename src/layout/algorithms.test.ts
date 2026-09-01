import { describe, it, expect } from 'vitest';
import { treeLayout, forceLayout, radialLayout, circleLayout, gridLayout } from './algorithms';
import type { LayoutEdge, LayoutNode, Positions } from './types';

const nodes: LayoutNode[] = [
    { id: 'a', w: 40, h: 20 },
    { id: 'b', w: 40, h: 20 },
    { id: 'c', w: 40, h: 20 },
    { id: 'd', w: 40, h: 20 },
] as LayoutNode[];
const edges: LayoutEdge[] = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'a', target: 'd' },
] as LayoutEdge[];

function assertAllPlaced(pos: Positions, ns: LayoutNode[]) {
    for (const n of ns) {
        const p = pos.get(n.id);
        expect(p, `node ${n.id} placed`).toBeTruthy();
        expect(Number.isFinite(p!.x) && Number.isFinite(p!.y), `node ${n.id} finite`).toBe(true);
    }
}

describe('layout algorithms place every node at finite coordinates', () => {
    it('treeLayout', () => assertAllPlaced(treeLayout(nodes, edges, 'TB'), nodes));
    it('forceLayout', () => assertAllPlaced(forceLayout(nodes, edges, 3), nodes));
    it('radialLayout', () => assertAllPlaced(radialLayout(nodes, edges), nodes));
    it('circleLayout', () => assertAllPlaced(circleLayout(nodes), nodes));
    it('gridLayout', () => assertAllPlaced(gridLayout(nodes), nodes));
    it('handles a single disconnected node', () => {
        const one = [{ id: 'solo', w: 40, h: 20 }] as LayoutNode[];
        assertAllPlaced(circleLayout(one), one);
        assertAllPlaced(gridLayout(one), one);
        assertAllPlaced(radialLayout(one, []), one);
    });
});

describe('deterministic layout structure', () => {
    it('gridLayout lays nodes out in rows from a fixed origin', () => {
        const pos = gridLayout(nodes);
        expect(pos.get('a')).toEqual({ x: 80, y: 70 });
        // second node is to the right of the first, same row
        expect(pos.get('b')!.x).toBeGreaterThan(pos.get('a')!.x);
        expect(pos.get('b')!.y).toBe(pos.get('a')!.y);
    });

    it('circleLayout places every node equidistant from the centre', () => {
        const pos = circleLayout(nodes);
        const cx = 480,
            cy = 340;
        const r0 = Math.hypot(pos.get('a')!.x - cx, pos.get('a')!.y - cy);
        for (const n of nodes) {
            const r = Math.hypot(pos.get(n.id)!.x - cx, pos.get(n.id)!.y - cy);
            expect(Math.abs(r - r0)).toBeLessThan(1e-6);
        }
    });

    it('radialLayout puts the most-connected node at the centre', () => {
        // 'a' has the highest degree (a-b, a-d) so it is the ring-0 root
        const pos = radialLayout(nodes, edges);
        expect(pos.get('a')).toEqual({ x: 480, y: 340 });
    });
});
