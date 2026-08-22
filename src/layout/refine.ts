// Post-passes over a base layout: crossing-reducing position swaps and
// overlap-free compaction toward the centroid.

import type { LayoutEdge, LayoutNode, Point, Positions } from './types';
import { segsIntersect, NODE_MARGIN } from './metrics';
import { rng } from './rng';

/** Crossings among edges incident to the given nodes, versus all edges. */
function incidentCrossings(
  ids: Set<string>,
  segs: { s: string; t: string }[],
  centers: Map<string, Point>
): number {
  const touch = segs.filter((e) => ids.has(e.s) || ids.has(e.t));
  let n = 0;
  for (const A of touch) {
    for (const B of segs) {
      if (A === B) continue;
      if (A.s === B.s || A.s === B.t || A.t === B.s || A.t === B.t) continue;
      // avoid double counting pairs where both touch the swapped nodes
      if ((ids.has(B.s) || ids.has(B.t)) && segs.indexOf(B) < segs.indexOf(A)) continue;
      if (segsIntersect(centers.get(A.s)!, centers.get(A.t)!, centers.get(B.s)!, centers.get(B.t)!)) n++;
    }
  }
  return n;
}

/** Hill-climb: swap node positions when it reduces edge crossings. Deterministic. */
export function refineBySwaps(pos: Positions, edges: LayoutEdge[], nodes: LayoutNode[], attempts = 1200): Positions {
  const nodeIds = nodes.map((n) => n.id);
  if (nodeIds.length < 3) return pos;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const segs = edges
    .filter((e) => pos.has(e.source) && pos.has(e.target) && e.source !== e.target)
    .map((e) => ({ s: e.source, t: e.target }));
  if (segs.length < 2) return pos;
  const centers = new Map<string, Point>();
  const syncCenter = (id: string) => {
    const p = pos.get(id)!;
    const n = byId.get(id)!;
    centers.set(id, { x: p.x + n.w / 2, y: p.y + n.h / 2 });
  };
  for (const id of nodeIds) syncCenter(id);
  const rand = rng(42);
  for (let k = 0; k < attempts; k++) {
    const a = nodeIds[Math.floor(rand() * nodeIds.length)];
    const b = nodeIds[Math.floor(rand() * nodeIds.length)];
    if (a === b) continue;
    const ids = new Set([a, b]);
    const before = incidentCrossings(ids, segs, centers);
    const pa = pos.get(a)!;
    const pb = pos.get(b)!;
    pos.set(a, pb);
    pos.set(b, pa);
    syncCenter(a);
    syncCenter(b);
    const after = incidentCrossings(ids, segs, centers);
    if (after > before) {
      pos.set(a, pa);
      pos.set(b, pb);
      syncCenter(a);
      syncCenter(b);
    }
  }
  return pos;
}

/** Uniformly pull nodes toward the centroid as far as overlaps allow.
 *  Straight-line crossings are scale-invariant, so this only improves screen fit. */
export function compact(pos: Positions, nodes: LayoutNode[]): Positions {
  if (nodes.length < 2) return pos;
  let cx = 0, cy = 0;
  for (const n of nodes) {
    const p = pos.get(n.id)!;
    cx += p.x;
    cy += p.y;
  }
  cx /= nodes.length;
  cy /= nodes.length;
  const overlapsAt = (scale: number): boolean => {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const pa = pos.get(a.id)!;
      const ax = cx + (pa.x - cx) * scale;
      const ay = cy + (pa.y - cy) * scale;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const pb = pos.get(b.id)!;
        const bx = cx + (pb.x - cx) * scale;
        const by = cy + (pb.y - cy) * scale;
        if (Math.abs(ax - bx) < (a.w + b.w) / 2 + NODE_MARGIN + 2 && Math.abs(ay - by) < (a.h + b.h) / 2 + NODE_MARGIN + 2)
          return true;
      }
    }
    return false;
  };
  // binary search the smallest overlap-free scale
  let lo = 0.3, hi = 1;
  if (!overlapsAt(lo)) hi = lo;
  else {
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2;
      if (overlapsAt(mid)) lo = mid;
      else hi = mid;
    }
  }
  if (hi >= 0.999) return pos;
  const out: Positions = new Map();
  for (const n of nodes) {
    const p = pos.get(n.id)!;
    out.set(n.id, { x: cx + (p.x - cx) * hi, y: cy + (p.y - cy) * hi });
  }
  return out;
}
