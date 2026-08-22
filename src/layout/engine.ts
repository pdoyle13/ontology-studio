// The layout engine facade: run an algorithm, or 'auto' — score every
// candidate (plus seeded force restarts), refine the winner (crossing-reducing
// swaps), then compact. Pure; returns positions + the metrics that justified them.

import type { LayoutAlgo, LayoutEdge, LayoutNode, LayoutResult, Positions } from './types';
import { measureLayout } from './metrics';
import { treeLayout, forceLayout, radialLayout, circleLayout, gridLayout } from './algorithms';
import { refineBySwaps, compact } from './refine';

export const LAYOUTS: { id: LayoutAlgo; label: string }[] = [
  { id: 'auto', label: 'Auto (best)' },
  { id: 'tree-lr', label: 'Tree →' },
  { id: 'tree-tb', label: 'Tree ↓' },
  { id: 'force', label: 'Force' },
  { id: 'radial', label: 'Radial' },
  { id: 'circle', label: 'Circle' },
  { id: 'grid', label: 'Grid' },
];

function runBase(algo: Exclude<LayoutAlgo, 'auto'>, nodes: LayoutNode[], edges: LayoutEdge[], seed = 1): Positions {
  switch (algo) {
    case 'tree-lr':
      return treeLayout(nodes, edges, 'LR');
    case 'tree-tb':
      return treeLayout(nodes, edges, 'TB');
    case 'force':
      return forceLayout(nodes, edges, seed);
    case 'radial':
      return radialLayout(nodes, edges);
    case 'circle':
      return circleLayout(nodes);
    case 'grid':
      return gridLayout(nodes);
  }
}

function autoLayout(nodes: LayoutNode[], edges: LayoutEdge[]): LayoutResult {
  const candidates: { name: string; pos: Positions }[] = [
    { name: 'tree-lr', pos: treeLayout(nodes, edges, 'LR') },
    { name: 'tree-tb', pos: treeLayout(nodes, edges, 'TB') },
    { name: 'radial', pos: radialLayout(nodes, edges) },
    ...(nodes.length <= 14 ? [{ name: 'circle', pos: circleLayout(nodes) }] : []),
    ...(edges.length === 0 ? [{ name: 'grid', pos: gridLayout(nodes) }] : []),
    ...[1, 2, 3, 4, 5].map((s) => ({ name: `force#${s}`, pos: forceLayout(nodes, edges, s) })),
  ];
  let best: { name: string; pos: Positions; metrics: ReturnType<typeof measureLayout> } | null = null;
  for (const c of candidates) {
    const m = measureLayout(c.pos, edges, nodes);
    if (!best || m.cost < best.metrics.cost) best = { ...c, metrics: m };
  }
  // untangle the winner: position swaps that reduce crossings
  if (best!.metrics.crossings > 0) {
    const refined = refineBySwaps(new Map(best!.pos), edges, nodes, Math.min(6000, nodes.length * 90));
    const m = measureLayout(refined, edges, nodes);
    if (m.cost < best!.metrics.cost) best = { name: `${best!.name}+swaps`, pos: refined, metrics: m };
  }
  // then shrink to fit: pull toward the centroid as far as overlaps allow
  const packed = compact(best!.pos, nodes);
  const pm = measureLayout(packed, edges, nodes);
  if (pm.cost <= best!.metrics.cost) best = { name: best!.name, pos: packed, metrics: pm };
  return { positions: best!.pos, picked: best!.name, metrics: best!.metrics };
}

export function layout(algo: LayoutAlgo, nodes: LayoutNode[], edges: LayoutEdge[]): LayoutResult {
  if (nodes.length === 0) return { positions: new Map(), picked: algo, metrics: measureLayout(new Map(), [], []) };
  if (algo === 'auto') return autoLayout(nodes, edges);
  const positions = runBase(algo, nodes, edges);
  return { positions, picked: algo, metrics: measureLayout(positions, edges, nodes) };
}
