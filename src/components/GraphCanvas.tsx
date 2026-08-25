import { useCallback, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  ConnectionLineType,
  ConnectionMode,
  BaseEdge,
  EdgeLabelRenderer,
  useInternalNode,
  type EdgeProps,
  type NodeChange,
  type NodeProps,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { getNodesBounds, getViewportForBounds } from '@xyflow/react';
import { toPng } from 'html-to-image';
import { useCanvas, type RdfNode, type RdfNodeData } from '../state/canvas';
import { LAYOUTS, bestAnchorPair, type LayoutAlgo } from '../layout';
import { useContextMenu } from './ContextMenu';
import { RelationPicker, rememberPredicate, type JoinSpec } from './RelationPicker';
import { cmdInsertMany } from '../rdf/commands';
import { confirmDialog, openCreateInstance } from './Modal';
import { openDataGrid } from './DataGrid';
import { openSourceEditor } from './SourceEditor';
import { cmdDelete, cmdDeleteResource, cmdRenameIri } from '../rdf/commands';
import { useConnection as useConn2 } from '../state/connection';
import { useGraph } from '../state/graph';
import { useConnection } from '../state/connection';
import { useHistory } from '../state/history';
import { useValidation } from '../state/validation';
import { cmdInsert } from '../rdf/commands';
import type { Connection } from '@xyflow/react';

function RdfNodeView({ data, selected }: NodeProps & { data: RdfNodeData }) {
  const hasViolation = useValidation((s) => s.violations.some((v) => v.focusNode === data.iri));
  const border = data.hue !== null ? `hsl(${data.hue} 38% 52%)` : 'var(--border-strong)';
  const quick = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div
      className={`rdf-node ${selected ? 'selected' : ''} ${hasViolation ? 'violation' : ''}`}
      style={{ borderLeftColor: hasViolation ? 'var(--err)' : border }}
    >
      <Handle type="target" position={Position.Left} className="rdf-handle" />
      <div className="node-quick-actions nodrag">
        <button className="quick" title="Expand neighbors" onClick={quick(() => useCanvas.getState().expandNode(data.iri))}>
          ⇅
        </button>
        <button
          className="quick"
          title="Add property"
          onClick={quick(() => {
            useGraph.getState().selectResource(data.iri);
            import('../state/ui').then(({ useUi }) => useUi.getState().setAddPropertyIntent(true));
          })}
        >
          +
        </button>
        <button className="quick" title="Hide from canvas" onClick={quick(() => useCanvas.getState().removeNode(data.iri))}>
          ✕
        </button>
      </div>
      <div className="rdf-node-label">{data.label}</div>
      {data.typeCurie && (
        <div className="rdf-node-type" style={{ color: border }}>
          {data.typeCurie}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="rdf-handle" />
    </div>
  );
}

const nodeTypes = { rdfNode: RdfNodeView };

/** Straight edge anchored at the best pair of side midpoints (top/right/bottom/left) —
 *  anchor choice comes from the layout engine so render matches what it optimized. */
function MidpointEdge({ id, source, target, label, style }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;

  const box = (n: typeof sourceNode) => ({
    x: n.internals.positionAbsolute.x,
    y: n.internals.positionAbsolute.y,
    w: n.measured.width ?? 180,
    h: n.measured.height ?? 52,
  });
  const { from, to } = bestAnchorPair(box(sourceNode), box(targetNode));
  const path = `M ${from.x},${from.y} L ${to.x},${to.y}`;
  const lx = (from.x + to.x) / 2;
  const ly = (from.y + to.y) / 2;

  return (
    <>
      <BaseEdge id={id} path={path} style={style} className="rdf-edge-path" />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="edge-label"
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          >
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { mid: MidpointEdge };

export function GraphCanvas() {
  const { nodes, edges, onNodesChange, expandNode, removeNode, clear, relayout, expanding, addEdgeLocal, loadSchemaOverview, layoutAlgo, setLayoutAlgo } = useCanvas();
  const selectResource = useGraph((s) => s.selectResource);
  const refreshSelected = useGraph((s) => s.refreshSelected);

  const { undoStack, redoStack, undo, redo } = useHistory();

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Delete/Backspace emits 'remove' — hide from canvas (with edge cleanup),
      // never a graph mutation; explicit deletion lives in the context menu.
      const removals = changes.filter((c) => c.type === 'remove');
      const rest = changes.filter((c) => c.type !== 'remove');
      removals.forEach((c) => removeNode(c.id));
      if (rest.length) onNodesChange(applyNodeChanges(rest, useCanvas.getState().nodes as RdfNode[]) as RdfNode[]);
    },
    [onNodesChange, removeNode]
  );

  // drag-to-create relation: park the pending connection, show the inline picker
  const [pendingRel, setPendingRel] = useState<{ source: string; target: string; at: { x: number; y: number } } | null>(null);

  const handleConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    setPendingRel({ source: c.source, target: c.target, at: { x: lastPointer.current.x, y: lastPointer.current.y } });
  }, []);

  const commitRelation = useCallback(
    async (predicate: string, mintedLabel?: string) => {
      if (!pendingRel) return;
      const conn = useConnection.getState();
      const ep = conn.active();
      if (!ep) return;
      const { source, target } = pendingRel;
      setPendingRel(null);
      rememberPredicate(predicate);
      try {
        if (mintedLabel) {
          // brand-new predicate typed by name: declare it so it labels
          // correctly and shows up in future pickers
          await cmdInsert(ep, conn.activeGraph, predicate, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
            { type: 'uri', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property' }, 'declare property');
          await cmdInsert(ep, conn.activeGraph, predicate, 'http://www.w3.org/2000/01/rdf-schema#label',
            { type: 'literal', value: mintedLabel }, 'label property');
        }
        await cmdInsert(ep, conn.activeGraph, source, predicate, { type: 'uri', value: target }, 'create edge');
        addEdgeLocal(source, predicate, target);
        refreshSelected();
      } catch (e) {
        window.alert(`Edge creation failed: ${(e as Error).message}`);
      }
    },
    [pendingRel, addEdgeLocal, refreshSelected]
  );

  const lastPointer = useRef({ x: 300, y: 300 });

  const exportPng = useCallback(() => {
    const el = document.querySelector('.react-flow__viewport') as HTMLElement | null;
    if (!el || nodes.length === 0) return;
    const bounds = getNodesBounds(nodes as RdfNode[]);
    const width = Math.min(3200, Math.max(800, Math.ceil(bounds.width) + 120));
    const height = Math.min(3200, Math.max(600, Math.ceil(bounds.height) + 120));
    const vp = getViewportForBounds(bounds, width, height, 0.2, 2.5, 0.06);
    toPng(el, {
      width,
      height,
      backgroundColor: getComputedStyle(document.body).getPropertyValue('--bg') || '#16181d',
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
      },
      filter: (node) => !(node as HTMLElement).classList?.contains('node-quick-actions'),
    }).then((url) => {
      const a = document.createElement('a');
      a.download = 'ontology-canvas.png';
      a.href = url;
      a.click();
    });
  }, [nodes]);

  const doUndo = () => undo().then(() => refreshSelected());
  const doRedo = () => redo().then(() => refreshSelected());

  // drag-and-drop from the class tree: drop a resource at the cursor position
  const flowRef = useRef<{ screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number } } | null>(null);
  const { addResource } = useCanvas();
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const iri = e.dataTransfer.getData('application/x-studio-iri');
      if (!iri) return;
      e.preventDefault();
      const at = flowRef.current
        ? flowRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
        : undefined;
      // dropping ONTO an existing node means "link these two" — hit-test in
      // flow coordinates (screen-space elementFromPoint misses when zoomed/panned)
      const hit = at
        ? useCanvas.getState().nodes.find((n) => {
            const w = (n as { measured?: { width?: number } }).measured?.width ?? 180;
            const h = (n as { measured?: { height?: number } }).measured?.height ?? 52;
            return at.x >= n.position.x && at.x <= n.position.x + w && at.y >= n.position.y && at.y <= n.position.y + h;
          })?.id
        : undefined;
      if (hit && hit !== iri) {
        addResource(iri, at ? { x: at.x + 240, y: at.y } : undefined);
        lastPointer.current = { x: e.clientX, y: e.clientY };
        setPendingRel({ source: hit, target: iri, at: { x: e.clientX, y: e.clientY } });
        return;
      }
      addResource(iri, at);
      selectResource(iri);
    },
    [addResource, selectResource]
  );

  // field-level cross-DB link: write only the meta declaration; instance
  // traversal resolves live from it (virtual layer, federation, lineage)
  const commitJoinLink = useCallback(
    async (spec: JoinSpec) => {
      if (!pendingRel) return;
      const conn = useConnection.getState();
      const ep = conn.active();
      if (!ep) return;
      const { source, target } = pendingRel;
      setPendingRel(null);
      const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
      const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
      const STUDIO = 'https://studio.local/ns#';
      try {
        await cmdInsertMany(ep, conn.activeGraph, [
          { s: spec.predicate, p: `${RDF}type`, o: { type: 'uri', value: `${RDF}Property` } },
          { s: spec.predicate, p: `${RDFS}label`, o: { type: 'literal', value: spec.label } },
          { s: spec.predicate, p: `${RDFS}domain`, o: { type: 'uri', value: source } },
          { s: spec.predicate, p: `${RDFS}range`, o: { type: 'uri', value: target } },
          { s: spec.predicate, p: `${STUDIO}sourceKeyProperty`, o: { type: 'uri', value: spec.sourceKey } },
          { s: spec.predicate, p: `${STUDIO}targetKeyProperty`, o: { type: 'uri', value: spec.targetKey } },
        ], 'declare link');
        addEdgeLocal(source, spec.predicate, target);
        refreshSelected();
      } catch (e) {
        window.alert(`Link creation failed: ${(e as Error).message}`);
      }
    },
    [pendingRel, addEdgeLocal, refreshSelected]
  );

  return (
    <div
      className="canvas-wrap"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-studio-iri')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={handleDrop}
      onMouseMove={(e) => {
        lastPointer.current = { x: e.clientX, y: e.clientY };
      }}
    >
      <div className="canvas-toolbar">
        <button className="ghost" onClick={doUndo} disabled={undoStack.length === 0} title="Undo (Ctrl+Z)">
          ⟲ Undo
        </button>
        <button className="ghost" onClick={doRedo} disabled={redoStack.length === 0} title="Redo (Ctrl+Y)">
          ⟳ Redo
        </button>
        <button className="ghost" onClick={loadSchemaOverview} title="Show all classes and how they connect">
          ⌂ Overview
        </button>
        <button
          className="ghost"
          onClick={() => useCanvas.getState().loadFlowView()}
          title="Data warehouses → business objects → outputs/decisions"
        >
          ⛃ Flow
        </button>
        <select
          value={layoutAlgo}
          onChange={(e) => setLayoutAlgo(e.target.value as LayoutAlgo)}
          title="Layout algorithm"
        >
          {LAYOUTS.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
        <button className="ghost" onClick={relayout} disabled={nodes.length === 0}>
          Re-layout
        </button>
        <button className="ghost" onClick={openSourceEditor} title="Edit the active graph as raw Turtle (diff-applied)">
          { } Source
        </button>
        <button className="ghost" onClick={exportPng} disabled={nodes.length === 0} title="Export the canvas as PNG">
          ⇓ PNG
        </button>
        <button className="ghost" onClick={clear} disabled={nodes.length === 0}>
          Clear
        </button>
        {expanding && <span className="tree-loading">expanding…</span>}
        {nodes.length === 0 && (
          <span className="tree-loading">click a resource in the sidebar to add it — double-click a node to expand</span>
        )}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onConnect={handleConnect}
        onNodeClick={(_, n) => selectResource(n.id)}
        onNodeDoubleClick={(_, n) => expandNode(n.id)}
        onNodeContextMenu={(e, n) => {
          e.preventDefault();
          const data = n.data as RdfNodeData;
          const isVirtual = n.id.startsWith('https://studio.local/sql/') && /#[\w-]+\//.test(n.id);
          useContextMenu.getState().show(e.clientX, e.clientY, [
            { label: '⇅ Expand neighbors', onClick: () => expandNode(n.id) },
            { label: '▤ Open in inspector', onClick: () => selectResource(n.id) },
            { label: '✄ Hide from canvas', onClick: () => removeNode(n.id) },
            { label: '⧉ Copy IRI', onClick: () => navigator.clipboard?.writeText(data.iri) },
            {
              label: '✎ Rename IRI…',
              disabled: isVirtual,
              onClick: async () => {
                const next = window.prompt('New IRI (rewrites subject/predicate/object across ALL graphs):', n.id);
                if (!next?.trim() || next === n.id) return;
                const conn = useConn2.getState();
                const ep = conn.active();
                if (!ep) return;
                await cmdRenameIri(ep, n.id, next.trim());
                removeNode(n.id);
                useCanvas.getState().addResource(next.trim());
                refreshSelected();
              },
            },
            { separator: true, label: '' },
            ...(data.types.includes('http://www.w3.org/2000/01/rdf-schema#Class')
              ? [
                  { label: '+ New instance…', onClick: () => openCreateInstance(n.id) },
                  { label: '⊞ Browse data (grid)', onClick: () => openDataGrid(n.id) },
                ]
              : []),
            {
              label: '✕ Delete resource…',
              danger: true,
              disabled: isVirtual,
              onClick: async () => {
                const conn = useConn2.getState();
                const ep = conn.active();
                if (!ep) return;
                if (!(await confirmDialog('Delete resource', `Delete ${data.label} and its incoming references? Undo can restore it.`))) return;
                cmdDeleteResource(ep, conn.activeGraph, n.id, true).then(() => {
                  removeNode(n.id);
                  refreshSelected();
                });
              },
            },
          ]);
        }}
        onEdgeContextMenu={(e, edge) => {
          e.preventDefault();
          const parts = edge.id.split('|');
          if (parts.length !== 3 || edge.id.startsWith('flow:')) return;
          const [s, p, o] = parts;
          useContextMenu.getState().show(e.clientX, e.clientY, [
            { label: '▤ Open predicate in inspector', onClick: () => selectResource(p) },
            { label: '⧉ Copy statement', onClick: () => navigator.clipboard?.writeText(`<${s}> <${p}> <${o}> .`) },
            { separator: true, label: '' },
            {
              label: `✕ Remove this ${String(edge.label ?? 'link')} value`,
              danger: true,
              onClick: () => {
                const conn = useConn2.getState();
                const ep = conn.active();
                if (!ep) return;
                cmdDelete(ep, conn.activeGraph, s, p, { type: 'uri', value: o }).then(() => {
                  useCanvas.setState({ edges: useCanvas.getState().edges.filter((x) => x.id !== edge.id) });
                  refreshSelected();
                });
              },
            },
          ]);
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          const me = e as React.MouseEvent;
          useContextMenu.getState().show(me.clientX, me.clientY, [
            { label: '⌂ Schema overview', onClick: () => loadSchemaOverview() },
            { label: '⛃ Flow view', onClick: () => useCanvas.getState().loadFlowView() },
            { label: '⟳ Re-layout', onClick: () => relayout() },
            { separator: true, label: '' },
            { label: '✕ Clear canvas', onClick: () => clear() },
          ]);
        }}
        onInit={(instance) => {
          flowRef.current = instance;
          useCanvas.getState().setFlowInstance(instance);
        }}
        fitView
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
        defaultEdgeOptions={{ type: 'mid' }}
        connectionLineType={ConnectionLineType.Straight}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={80}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Control', 'Meta']}
        deleteKeyCode={['Delete', 'Backspace']}
      >
        <Background gap={22} color="#23262d" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="rdf-minimap" />
      </ReactFlow>
      {pendingRel && (
        <RelationPicker
          at={{ x: Math.min(pendingRel.at.x, window.innerWidth - 320), y: Math.min(pendingRel.at.y, window.innerHeight - 280) }}
          sourceIri={pendingRel.source}
          targetIri={pendingRel.target}
          sourceLabel={(nodes.find((n) => n.id === pendingRel.source)?.data.label as string) ?? pendingRel.source}
          targetLabel={(nodes.find((n) => n.id === pendingRel.target)?.data.label as string) ?? pendingRel.target}
          onPick={commitRelation}
          onPickJoin={commitJoinLink}
          onCancel={() => setPendingRel(null)}
        />
      )}
    </div>
  );
}
