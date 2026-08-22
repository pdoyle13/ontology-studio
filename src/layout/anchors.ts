// Edge anchoring: edges attach at one of the four side midpoints of each node,
// choosing the pair with the shortest connection. Shared by the renderer (so
// what you see is what the engine optimized) and available to metrics/tests.

import type { Point } from './types';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function sideMidpoints(b: Box): Point[] {
  return [
    { x: b.x + b.w / 2, y: b.y },          // top
    { x: b.x + b.w, y: b.y + b.h / 2 },    // right
    { x: b.x + b.w / 2, y: b.y + b.h },    // bottom
    { x: b.x, y: b.y + b.h / 2 },          // left
  ];
}

/** Best (closest) pair of side midpoints between two boxes. */
export function bestAnchorPair(a: Box, b: Box): { from: Point; to: Point } {
  let best: { from: Point; to: Point; d: number } | null = null;
  for (const p of sideMidpoints(a)) {
    for (const q of sideMidpoints(b)) {
      const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (!best || d < best.d) best = { from: p, to: q, d };
    }
  }
  return { from: best!.from, to: best!.to };
}
