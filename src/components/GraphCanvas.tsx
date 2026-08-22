import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  type NodeChange,
  type NodeProps,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCanvas, type RdfNode, type RdfNodeData } from '../state/canvas';
import { useGraph } from '../state/graph';
import { useConnection } from '../state/connection';
import { useHistory } from '../state/history';
import { cmdInsert } from '../rdf/commands';
import type { Connection } from '@xyflow/react';

function RdfNodeView({ data, selected }: NodeProps & { data: RdfNodeData }) {
  const border = data.hue !== null ? `hsl(${data.hue} 55% 55%)` : 'var(--border)';
  return (
    <div className={`rdf-node ${selected ? 'selected' : ''}`} style={{ borderColor: border }}>
      <Handle type="target" position={Position.Left} className="rdf-handle" />
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

export function GraphCanvas() {
  const { nodes, edges, onNodesChange, expandNode, removeNode, clear, relayout, expanding, addEdgeLocal } = useCanvas();
  const selectResource = useGraph((s) => s.selectResource);
  const refreshSelected = useGraph((s) => s.refreshSelected);
  const prefixes = useGraph((s) => s.prefixes);
  const { undoStack, redoStack, undo, redo } = useHistory();

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(applyNodeChanges(changes, nodes as RdfNode[]) as RdfNode[]);
    },
    [nodes, onNodesChange]
  );

  const handleConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      const conn = useConnection.getState();
      const ep = conn.active();
      if (!ep) return;
      const input = window.prompt('Predicate for this edge (curie or IRI):', 'rdfs:seeAlso');
      if (!input) return;
      const p = prefixes.expand(input.trim());
      cmdInsert(ep, conn.activeGraph, c.source, p, { type: 'uri', value: c.target }, 'create edge')
        .then(() => {
          addEdgeLocal(c.source!, p, c.target!);
          refreshSelected();
        })
        .catch((e) => window.alert(`Edge creation failed: ${(e as Error).message}`));
    },
    [prefixes, addEdgeLocal, refreshSelected]
  );

  const doUndo = () => undo().then(() => refreshSelected());
  const doRedo = () => redo().then(() => refreshSelected());

  return (
    <div className="canvas-wrap">
      <div className="canvas-toolbar">
        <button className="ghost" onClick={doUndo} disabled={undoStack.length === 0} title="Undo (Ctrl+Z)">
          ⟲ Undo
        </button>
        <button className="ghost" onClick={doRedo} disabled={redoStack.length === 0} title="Redo (Ctrl+Y)">
          ⟳ Redo
        </button>
        <button className="ghost" onClick={relayout} disabled={nodes.length === 0}>
          Auto-layout
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
        onNodesChange={handleNodesChange}
        onConnect={handleConnect}
        onNodeClick={(_, n) => selectResource(n.id)}
        onNodeDoubleClick={(_, n) => expandNode(n.id)}
        onNodeContextMenu={(e, n) => {
          e.preventDefault();
          removeNode(n.id);
        }}
        fitView
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
        defaultEdgeOptions={{ labelStyle: { fill: 'var(--text-dim)', fontSize: 10 } }}
      >
        <Background gap={22} color="#23262d" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="rdf-minimap" />
      </ReactFlow>
    </div>
  );
}
