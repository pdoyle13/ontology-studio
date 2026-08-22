// Canvas layout algorithms. Each takes the current nodes/edges and returns new
// positions; the store applies them. All run synchronously.

import dagre from 'dagre';
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide } from 'd3-force';
import type { Edge } from '@xyflow/react';
import type { RdfNode } from './canvas';

export type LayoutAlgo = 'tree-lr' | 'tree-tb' | 'force' | 'radial' | 'circle' | 'grid';

export const LAYOUTS: { id: LayoutAlgo; label: string }[] = [
  { id: 'tree-lr', label: 'Tree →' },
  { id: 'tree-tb', label: 'Tree ↓' },
  { id: 'force', label: 'Force' },
  { id: 'radial', label: 'Radial' },
  { id: 'circle', label: 'Circle' },
  { id: 'grid', label: 'Grid' },
];

const W = 180;
const H = 52;

type Pos = Map<string, { x: number; y: number }>;

function treeLayout(nodes: RdfNode[], edges: Edge[], rankdir: 'LR' | 'TB'): Pos {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, nodesep: 42, ranksep: rankdir === 'LR' ? 95 : 70 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: W, height: H });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const pos: Pos = new Map();
  for (const n of nodes) {
    const p = g.node(n.id);
    if (p) pos.set(n.id, { x: p.x - W / 2, y: p.y - H / 2 });
  }
  return pos;
}

function forceLayout(nodes: RdfNode[], edges: Edge[]): Pos {
  const simNodes = nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
  const simLinks = edges
    .filter((e) => simNodes.some((n) => n.id === e.source) && simNodes.some((n) => n.id === e.target))
    .map((e) => ({ source: e.source, target: e.target }));
  const sim = forceSimulation(simNodes as { id: string; x: number; y: number }[])
    .force('charge', forceManyBody().strength(-420))
    .force('link', forceLink(simLinks).id((d) => (d as { id: string }).id).distance(170))
    .force('center', forceCenter(420, 300))
    .force('collide', forceCollide(70))
    .stop();
  for (let i = 0; i < 300; i++) sim.tick();
  const pos: Pos = new Map();
  for (const n of simNodes) pos.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
  return pos;
}

/** BFS rings around the most-connected node. */
function radialLayout(nodes: RdfNode[], edges: Edge[]): Pos {
  const degree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    degree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    adj.get(e.target)!.push(e.source);
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const root = [...degree.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? nodes[0]?.id;
  const ring = new Map<string, number>([[root, 0]]);
  const queue = [root];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (!ring.has(nb)) {
        ring.set(nb, (ring.get(cur) ?? 0) + 1);
        queue.push(nb);
      }
    }
  }
  let maxRing = 0;
  for (const r of ring.values()) maxRing = Math.max(maxRing, r);
  for (const n of nodes) if (!ring.has(n.id)) ring.set(n.id, maxRing + 1); // disconnected → outer ring
  const byRing = new Map<number, string[]>();
  for (const [id, r] of ring) {
    if (!byRing.has(r)) byRing.set(r, []);
    byRing.get(r)!.push(id);
  }
  const cx = 480;
  const cy = 340;
  const pos: Pos = new Map();
  for (const [r, ids] of byRing) {
    const radius = r * 190;
    ids.forEach((id, i) => {
      if (r === 0) {
        pos.set(id, { x: cx, y: cy });
        return;
      }
      const angle = (2 * Math.PI * i) / ids.length - Math.PI / 2 + r * 0.35;
      pos.set(id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    });
  }
  return pos;
}

function circleLayout(nodes: RdfNode[]): Pos {
  const cx = 480;
  const cy = 340;
  const radius = Math.max(160, nodes.length * 26);
  const pos: Pos = new Map();
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    pos.set(n.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  });
  return pos;
}

function gridLayout(nodes: RdfNode[]): Pos {
  const cols = Math.ceil(Math.sqrt(nodes.length * 1.6));
  const pos: Pos = new Map();
  nodes.forEach((n, i) => {
    pos.set(n.id, { x: 80 + (i % cols) * (W + 40), y: 70 + Math.floor(i / cols) * (H + 55) });
  });
  return pos;
}

export function computeLayout(algo: LayoutAlgo, nodes: RdfNode[], edges: Edge[]): Pos {
  switch (algo) {
    case 'tree-lr':
      return treeLayout(nodes, edges, 'LR');
    case 'tree-tb':
      return treeLayout(nodes, edges, 'TB');
    case 'force':
      return forceLayout(nodes, edges);
    case 'radial':
      return radialLayout(nodes, edges);
    case 'circle':
      return circleLayout(nodes);
    case 'grid':
      return gridLayout(nodes);
  }
}
