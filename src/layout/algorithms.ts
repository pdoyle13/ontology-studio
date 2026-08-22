// Base layout algorithms — pure functions LayoutNode/LayoutEdge → Positions.

import dagre from 'dagre';
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide } from 'd3-force';
import type { LayoutEdge, LayoutNode, Positions } from './types';
import { rng } from './rng';

export function treeLayout(nodes: LayoutNode[], edges: LayoutEdge[], rankdir: 'LR' | 'TB'): Positions {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, nodesep: 42, ranksep: rankdir === 'LR' ? 95 : 70 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.w, height: n.h });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const pos: Positions = new Map();
  for (const n of nodes) {
    const p = g.node(n.id);
    if (p) pos.set(n.id, { x: p.x - n.w / 2, y: p.y - n.h / 2 });
  }
  return pos;
}

export function forceLayout(nodes: LayoutNode[], edges: LayoutEdge[], seed = 1): Positions {
  const rand = rng(seed * 7919 + 13);
  // seeded circular init — deterministic and spread out, so ticks untangle instead of exploding
  const R = Math.max(220, nodes.length * 30);
  const simNodes = nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length + rand() * 2 * Math.PI;
    return {
      id: n.id,
      x: 500 + R * Math.cos(angle) * (0.6 + rand() * 0.6),
      y: 350 + R * Math.sin(angle) * (0.6 + rand() * 0.6),
    };
  });
  const ids = new Set(simNodes.map((n) => n.id));
  const simLinks = edges
    .filter((e) => e.source !== e.target && ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));
  const sim = forceSimulation(simNodes as { id: string; x: number; y: number }[])
    .force('charge', forceManyBody().strength(-650).distanceMax(900))
    .force('link', forceLink(simLinks).id((d) => (d as { id: string }).id).distance(190).strength(0.9))
    .force('center', forceCenter(500, 350))
    .force('collide', forceCollide(92).strength(0.95))
    .stop();
  for (let i = 0; i < 400; i++) sim.tick();
  const pos: Positions = new Map();
  for (const n of simNodes) pos.set(n.id, { x: (n.x ?? 0) * 1.35, y: n.y ?? 0 }); // widen: nodes are wide, screens are wide
  return pos;
}

/** BFS rings around the most-connected node. */
export function radialLayout(nodes: LayoutNode[], edges: LayoutEdge[]): Positions {
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
  const pos: Positions = new Map();
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

export function circleLayout(nodes: LayoutNode[]): Positions {
  const cx = 480;
  const cy = 340;
  const radius = Math.max(160, nodes.length * 26);
  const pos: Positions = new Map();
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    pos.set(n.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  });
  return pos;
}

export function gridLayout(nodes: LayoutNode[]): Positions {
  const cols = Math.ceil(Math.sqrt(nodes.length * 1.6));
  const maxW = Math.max(...nodes.map((n) => n.w), 1);
  const maxH = Math.max(...nodes.map((n) => n.h), 1);
  const pos: Positions = new Map();
  nodes.forEach((n, i) => {
    pos.set(n.id, { x: 80 + (i % cols) * (maxW + 40), y: 70 + Math.floor(i / cols) * (maxH + 55) });
  });
  return pos;
}
