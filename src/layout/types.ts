// Layout engine primitives. The engine knows nothing about React, react-flow,
// or RDF — it lays out boxes and straight edges. Adapters live at the edges.

export interface LayoutNode {
  id: string;
  w: number;
  h: number;
  /** current position (input hint for incremental algorithms) */
  x: number;
  y: number;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface Point {
  x: number;
  y: number;
}

/** node id → top-left position */
export type Positions = Map<string, Point>;

export interface LayoutMetrics {
  crossings: number;
  overlaps: number;
  area: number;
  aspectPenalty: number;
  cost: number;
}

export type LayoutAlgo = 'auto' | 'tree-lr' | 'tree-tb' | 'force' | 'radial' | 'circle' | 'grid';

export interface LayoutResult {
  positions: Positions;
  /** which candidate won (auto) or the algorithm name */
  picked: string;
  metrics: LayoutMetrics;
}
