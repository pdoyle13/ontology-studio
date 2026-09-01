// Layout quality measurement: edge crossings, node overlaps, footprint, aspect.
// Pure geometry over LayoutNode/Positions — used by the engine to pick winners
// and by tests/tools to audit any arrangement.

import type { LayoutEdge, LayoutMetrics, LayoutNode, Point, Positions } from './types';

export function segsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
    const o = (p: Point, q: Point, r: Point) => {
        const v = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
        return v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0;
    };
    return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b) && o(a, b, c) !== 0 && o(c, d, a) !== 0;
}

export const NODE_MARGIN = 14;

export function measureLayout(pos: Positions, edges: LayoutEdge[], nodes: LayoutNode[]): LayoutMetrics {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const center = (id: string): Point => {
        const p = pos.get(id)!;
        const n = byId.get(id)!;
        return { x: p.x + n.w / 2, y: p.y + n.h / 2 };
    };
    const segs = edges
        .filter((e) => pos.has(e.source) && pos.has(e.target) && e.source !== e.target)
        .map((e) => ({ s: e.source, t: e.target, a: center(e.source), b: center(e.target) }));

    let crossings = 0;
    for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) {
            const A = segs[i];
            const B = segs[j];
            if (A.s === B.s || A.s === B.t || A.t === B.s || A.t === B.t) continue; // shared node ≠ crossing
            if (segsIntersect(A.a, A.b, B.a, B.b)) crossings++;
        }
    }

    let overlaps = 0;
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i];
            const b = nodes[j];
            const p = pos.get(a.id)!;
            const q = pos.get(b.id)!;
            if (
                Math.abs(p.x - q.x) < (a.w + b.w) / 2 + NODE_MARGIN &&
                Math.abs(p.y - q.y) < (a.h + b.h) / 2 + NODE_MARGIN
            )
                overlaps++;
        }
    }

    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    for (const n of nodes) {
        const p = pos.get(n.id)!;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + n.w);
        maxY = Math.max(maxY, p.y + n.h);
    }
    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    const area = bw * bh;
    // screens are ~16:9-ish; punish tall/skinny or extremely wide layouts (they zoom out badly)
    const aspectPenalty = Math.abs(Math.log(bw / bh / 1.55));

    const idealArea = nodes.reduce((s, n) => s + (n.w + 60) * (n.h + 60), 0);
    const cost =
        crossings * 1000 + overlaps * 400 + Math.max(0, area / Math.max(idealArea, 1) - 1) * 60 + aspectPenalty * 120;
    return { crossings, overlaps, area, aspectPenalty, cost };
}
