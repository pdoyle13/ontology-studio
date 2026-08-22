// Canvas state: react-flow nodes/edges built incrementally from the graph.
// Nodes = IRI resources; literals stay in the inspector. Edges dedup by s|p|o.

import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import { layout, type LayoutAlgo, type LayoutMetrics, type LayoutNode } from '../layout';
import { describeResource } from '../rdf/queries';
import { select } from '../rdf/sparqlClient';
import { scoped } from '../rdf/queries';
import { localName } from '../rdf/prefixes';
import { displayName, humanize } from '../rdf/display';
import { useConnection } from './connection';
import { useGraph } from './graph';

export interface RdfNodeData extends Record<string, unknown> {
  iri: string;
  label: string;
  curie: string;
  types: string[];
  typeCurie: string | null;
  hue: number | null;
}

export type RdfNode = Node<RdfNodeData>;

function hueFor(iri: string | undefined): number | null {
  if (!iri) return null;
  let h = 0;
  for (let i = 0; i < iri.length; i++) h = (h * 31 + iri.charCodeAt(i)) >>> 0;
  return h % 360;
}

const EXPAND_LIMIT = 25;

export interface CanvasState {
  nodes: RdfNode[];
  edges: Edge[];
  expanding: string | null;
  onNodesChange: (nodes: RdfNode[]) => void;
  addResource: (iri: string, at?: { x: number; y: number }) => Promise<void>;
  expandNode: (iri: string) => Promise<void>;
  removeNode: (iri: string) => void;
  addTriples: (triples: { s: string; p: string; o: string; oIsIri: boolean }[]) => void;
  addEdgeLocal: (s: string, p: string, o: string) => void;
  clear: () => void;
  layoutAlgo: LayoutAlgo;
  setLayoutAlgo: (a: LayoutAlgo) => void;
  lastLayout: { picked: string; metrics: LayoutMetrics } | null;
  relayout: () => void;
  /** Root view: all classes as labeled nodes, connected by their object properties + subclass edges. */
  loadSchemaOverview: () => Promise<void>;
}

function makeNode(
  iri: string,
  label: string | null,
  types: string[],
  position: { x: number; y: number },
  typeLabel?: string | null
): RdfNode {
  const prefixes = useGraph.getState().prefixes;
  const primaryType = types[0];
  return {
    id: iri,
    type: 'rdfNode',
    position,
    data: {
      iri,
      label: displayName(iri, label),
      curie: prefixes.shrink(iri),
      types,
      typeCurie: primaryType ? (typeLabel ?? humanize(localName(primaryType))) : null,
      hue: hueFor(primaryType),
    },
  };
}

function edgeId(s: string, p: string, o: string) {
  return `${s}|${p}|${o}`;
}

export const useCanvas = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  expanding: null,

  onNodesChange: (nodes) => set({ nodes }),

  addResource: async (iri, at) => {
    if (get().nodes.some((n) => n.id === iri)) return;
    const conn = useConnection.getState();
    const ep = conn.active();
    if (!ep) return;
    const pos = at ?? { x: 120 + Math.random() * 240, y: 100 + Math.random() * 180 };
    // optimistic placeholder, then hydrate label/types
    set({ nodes: [...get().nodes, makeNode(iri, null, [], pos)] });
    try {
      const d = await describeResource(ep, conn.activeGraph, iri);
      set({
        nodes: get().nodes.map((n) => (n.id === iri ? makeNode(iri, d.label, d.types, n.position) : n)),
      });
      connectExisting(iri, set, get);
    } catch {
      /* placeholder stays */
    }
  },

  expandNode: async (iri) => {
    const conn = useConnection.getState();
    const ep = conn.active();
    if (!ep) return;
    set({ expanding: iri });
    try {
      const d = await describeResource(ep, conn.activeGraph, iri);
      const src = get().nodes.find((n) => n.id === iri);
      const cx = src?.position.x ?? 300;
      const cy = src?.position.y ?? 300;

      const neighbors: { iri: string; label: string | null; predicate: string; dir: 'out' | 'in' }[] = [];
      for (const s of d.outgoing) {
        if (s.object.type === 'uri' && s.predicate !== 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type')
          neighbors.push({ iri: s.object.value, label: s.object.label ?? null, predicate: s.predicate, dir: 'out' });
      }
      for (const s of d.incoming) {
        neighbors.push({ iri: s.subject, label: s.subjectLabel, predicate: s.predicate, dir: 'in' });
      }
      const limited = neighbors.slice(0, EXPAND_LIMIT);

      const nodes = [...get().nodes];
      const edges = [...get().edges];
      const existing = new Set(nodes.map((n) => n.id));
      const edgeIds = new Set(edges.map((e) => e.id));
      const prefixes = useGraph.getState().prefixes;

      const fresh = limited.filter((n) => !existing.has(n.iri));
      fresh.forEach((nb, i) => {
        const angle = (2 * Math.PI * i) / Math.max(fresh.length, 1) - Math.PI / 2;
        const r = 220 + (fresh.length > 12 ? 80 : 0);
        nodes.push(makeNode(nb.iri, nb.label, [], { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }));
        existing.add(nb.iri);
      });

      for (const nb of limited) {
        const [s, o] = nb.dir === 'out' ? [iri, nb.iri] : [nb.iri, iri];
        const id = edgeId(s, nb.predicate, o);
        if (!edgeIds.has(id)) {
          edges.push({
            id,
            source: s,
            target: o,
            label: prefixes.shrink(nb.predicate),
            type: 'mid', className: 'rdf-edge',
          });
          edgeIds.add(id);
        }
      }
      set({ nodes, edges, expanding: null });
      // hydrate types/labels for the fresh nodes in the background (bounded)
      for (const nb of fresh.slice(0, 12)) {
        describeResource(ep, conn.activeGraph, nb.iri)
          .then((dd) => {
            set({
              nodes: get().nodes.map((n) => (n.id === nb.iri ? makeNode(nb.iri, dd.label, dd.types, n.position) : n)),
            });
          })
          .catch(() => {});
      }
    } catch {
      set({ expanding: null });
    }
  },

  /** Bulk-load triples (e.g. CONSTRUCT results) onto the canvas: IRI-object triples become nodes+edges. */
  addTriples: (triples) => {
    const prefixes = useGraph.getState().prefixes;
    const nodes = [...get().nodes];
    const edges = [...get().edges];
    const existing = new Set(nodes.map((n) => n.id));
    const edgeIds = new Set(edges.map((e) => e.id));
    const labels = new Map<string, string>();
    for (const t of triples) {
      if (t.p === 'http://www.w3.org/2000/01/rdf-schema#label') labels.set(t.s, t.o);
    }
    let i = 0;
    const ensure = (iri: string) => {
      if (existing.has(iri)) return;
      const col = i % 8;
      const row = Math.floor(i / 8);
      i++;
      nodes.push(makeNode(iri, labels.get(iri) ?? null, [], { x: 80 + col * 200, y: 80 + row * 110 }));
      existing.add(iri);
    };
    for (const t of triples) {
      if (!t.oIsIri || t.p === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') continue;
      ensure(t.s);
      ensure(t.o);
      const id = edgeId(t.s, t.p, t.o);
      if (!edgeIds.has(id)) {
        edges.push({ id, source: t.s, target: t.o, label: prefixes.shrink(t.p), type: 'mid', className: 'rdf-edge' });
        edgeIds.add(id);
      }
    }
    set({ nodes, edges });
    get().relayout();
  },

  addEdgeLocal: (s, p, o) => {
    const id = edgeId(s, p, o);
    if (get().edges.some((e) => e.id === id)) return;
    const prefixes = useGraph.getState().prefixes;
    set({
      edges: [...get().edges, { id, source: s, target: o, label: prefixes.shrink(p), type: 'mid', className: 'rdf-edge' }],
    });
  },

  removeNode: (iri) => {
    set({
      nodes: get().nodes.filter((n) => n.id !== iri),
      edges: get().edges.filter((e) => e.source !== iri && e.target !== iri),
    });
  },

  clear: () => set({ nodes: [], edges: [] }),

  loadSchemaOverview: async () => {
    const conn = useConnection.getState();
    const ep = conn.active();
    if (!ep) return;
    const graphState = useGraph.getState();
    if (graphState.classes.length === 0) await graphState.loadClasses();
    const classes = useGraph.getState().classes
      .filter((cls) => !/w3\.org|datashapes\.org/.test(cls.iri))
      .slice(0, 40);
    if (classes.length === 0) return;

    // object-property links between classes: rdfs:domain/range + shape sh:class
    const SH = 'http://www.w3.org/ns/shacl#';
    const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
    let links: { src: string; prop: string; dst: string }[] = [];
    try {
      const r = await select(
        ep,
        `SELECT DISTINCT ?src ?prop ?dst WHERE {
  ${scoped(
    `{ ?prop <${RDFS}domain> ?src ; <${RDFS}range> ?dst . FILTER(isIRI(?dst) && !STRSTARTS(STR(?dst), "http://www.w3.org/2001/XMLSchema#")) }
     UNION { ?sh <${SH}targetClass> ?src ; <${SH}property> ?ps . ?ps <${SH}path> ?prop ; <${SH}class> ?dst }
     UNION { ?src <${RDFS}subClassOf> ?dst . BIND(<${RDFS}subClassOf> AS ?prop) }`,
    conn.activeGraph
  )}
} LIMIT 300`
      );
      links = r.bindings
        .filter((b) => b.src && b.prop && b.dst)
        .map((b) => ({ src: b.src.value, prop: b.prop.value, dst: b.dst.value }));
    } catch { /* overview still renders without edges */ }

    const nodes: RdfNode[] = classes.map((cls, i) =>
      makeNode(
        cls.iri,
        cls.label,
        ['http://www.w3.org/2000/01/rdf-schema#Class'],
        { x: 120 + (i % 6) * 220, y: 90 + Math.floor(i / 6) * 130 },
        `${cls.instances} instance${cls.instances === 1 ? '' : 's'}`
      )
    );
    const onCanvas = new Set(nodes.map((n) => n.id));
    const edges: Edge[] = [];
    const seen = new Set<string>();
    for (const l of links) {
      if (!onCanvas.has(l.src) || !onCanvas.has(l.dst) || l.src === l.dst) continue;
      const id = edgeId(l.src, l.prop, l.dst);
      if (seen.has(id)) continue;
      seen.add(id);
      const isSub = l.prop.endsWith('subClassOf');
      edges.push({
        id,
        source: l.src,
        target: l.dst,
        label: isSub ? 'is a' : humanize(localName(l.prop)),
        type: 'mid', className: 'rdf-edge',
        style: isSub ? { strokeDasharray: '5 4' } : undefined,
      });
    }
    set({ nodes, edges });
    get().relayout();
  },

  layoutAlgo: 'auto',
  setLayoutAlgo: (a) => {
    set({ layoutAlgo: a });
    get().relayout();
  },
  lastLayout: null,

  relayout: () => {
    const { nodes, edges, layoutAlgo } = get();
    if (nodes.length === 0) return;
    // adapt UI nodes → engine primitives (measured size when available)
    const layoutNodes: LayoutNode[] = nodes.map((n) => ({
      id: n.id,
      w: (n as { measured?: { width?: number } }).measured?.width ?? 180,
      h: (n as { measured?: { height?: number } }).measured?.height ?? 52,
      x: n.position.x,
      y: n.position.y,
    }));
    const result = layout(layoutAlgo, layoutNodes, edges.map((e) => ({ source: e.source, target: e.target })));
    set({
      lastLayout: { picked: result.picked, metrics: result.metrics },
      nodes: nodes.map((n) => {
        const p = result.positions.get(n.id);
        return p ? { ...n, position: p } : n;
      }),
    });
  },
}));

/** After adding a node, draw edges to nodes already on canvas (from its description). */
async function connectExisting(
  iri: string,
  set: (s: Partial<CanvasState>) => void,
  get: () => CanvasState
) {
  const conn = useConnection.getState();
  const ep = conn.active();
  if (!ep) return;
  try {
    const d = await describeResource(ep, conn.activeGraph, iri);
    const onCanvas = new Set(get().nodes.map((n) => n.id));
    const edges = [...get().edges];
    const edgeIds = new Set(edges.map((e) => e.id));
    const prefixes = useGraph.getState().prefixes;
    for (const s of d.outgoing) {
      if (s.object.type === 'uri' && onCanvas.has(s.object.value)) {
        const id = edgeId(iri, s.predicate, s.object.value);
        if (!edgeIds.has(id) && s.predicate !== 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') {
          edges.push({ id, source: iri, target: s.object.value, label: prefixes.shrink(s.predicate), type: 'mid', className: 'rdf-edge' });
          edgeIds.add(id);
        }
      }
    }
    for (const s of d.incoming) {
      if (onCanvas.has(s.subject)) {
        const id = edgeId(s.subject, s.predicate, iri);
        if (!edgeIds.has(id)) {
          edges.push({ id, source: s.subject, target: iri, label: prefixes.shrink(s.predicate), type: 'mid', className: 'rdf-edge' });
          edgeIds.add(id);
        }
      }
    }
    set({ edges });
  } catch {
    /* non-fatal */
  }
}

// Selecting a resource anywhere adds it to the canvas.
useGraph.subscribe((state, prev) => {
  if (state.selected && state.selected !== prev.selected) {
    useCanvas.getState().addResource(state.selected);
  }
});

// Opening a graph lands on the schema overview — the root view.
useConnection.subscribe((state, prev) => {
  if (state.status === 'connected' && (state.status !== prev.status || state.activeGraph !== prev.activeGraph)) {
    const canvas = useCanvas.getState();
    canvas.clear();
    // let loadClasses (triggered by the graph store's own subscription) land first
    setTimeout(() => useCanvas.getState().loadSchemaOverview(), 400);
  }
});
