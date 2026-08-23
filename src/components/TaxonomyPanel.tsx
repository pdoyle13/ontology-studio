// SKOS taxonomy tab: concept schemes as drag-editable broader/narrower trees.
// Drop a concept on another to re-parent it; drop on the scheme header to make
// it a top concept. All edits are undoable commands on the graph.

import { useCallback, useEffect, useState } from 'react';
import { useConnection } from '../state/connection';
import { useGraph } from '../state/graph';
import {
  listSchemes,
  fetchConcepts,
  buildTaxonomyTree,
  cmdReparentConcept,
  cmdRenameConcept,
  type SchemeInfo,
  type ConceptRow,
  type ConceptNode,
} from '../rdf/skos';
import { displayName } from '../rdf/display';
import { openAssetDialog } from './AssetDialog';
import { openExtensions } from './ExtensionsDialog';
import { openCsvImport } from './CsvImportDialog';
import { dragIri } from './ClassTree';

const CONCEPT_MIME = 'application/x-studio-concept';

function ConceptTreeNode({
  node,
  depth,
  rows,
  scheme,
  onChanged,
}: {
  node: ConceptNode;
  depth: number;
  rows: ConceptRow[];
  scheme: string;
  onChanged: () => void;
}) {
  const conn = useConnection();
  const { selected, selectResource } = useGraph();
  const [over, setOver] = useState(false);

  const reparentTo = useCallback(
    async (droppedIri: string) => {
      const ep = conn.active();
      if (!ep || droppedIri === node.iri) return;
      // no-op if the drop target is inside the dragged concept's own subtree
      let probe: string | null = node.iri;
      const guard = new Set<string>();
      while (probe && !guard.has(probe)) {
        if (probe === droppedIri) return;
        guard.add(probe);
        probe = rows.find((r) => r.iri === probe)?.broader ?? null;
      }
      const row = rows.find((r) => r.iri === droppedIri);
      await cmdReparentConcept(ep, conn.activeGraph, {
        concept: droppedIri,
        scheme,
        oldBroader: row?.broader ?? null,
        newBroader: node.iri,
      });
      onChanged();
    },
    [conn, node.iri, rows, scheme, onChanged]
  );

  const addChild = useCallback(() => {
    openAssetDialog({
      asset: 'concept',
      title: `New concept under “${displayName(node.iri, node.label)}”`,
      scheme,
      broader: node.iri,
      onDone: onChanged,
    });
  }, [node, scheme, onChanged]);

  const rename = useCallback(async () => {
    const ep = conn.active();
    if (!ep) return;
    const next = window.prompt('Rename concept:', node.label ?? '');
    if (!next?.trim() || next === node.label) return;
    await cmdRenameConcept(ep, conn.activeGraph, node.iri, node.label, next.trim());
    onChanged();
  }, [conn, node, onChanged]);

  return (
    <li>
      <div
        className={`skos-row ${selected === node.iri ? 'selected' : ''} ${over ? 'drop-target' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={node.iri}
        draggable
        onDragStart={(e) => {
          dragIri(e, node.iri);
          e.dataTransfer.setData(CONCEPT_MIME, node.iri);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(CONCEPT_MIME)) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          const iri = e.dataTransfer.getData(CONCEPT_MIME);
          if (iri) {
            e.preventDefault();
            e.stopPropagation();
            reparentTo(iri);
          }
        }}
        onClick={() => selectResource(node.iri)}
      >
        <span className="skos-label">{displayName(node.iri, node.label)}</span>
        <span className="skos-actions">
          <button className="micro" title="Add narrower concept" onClick={(e) => { e.stopPropagation(); addChild(); }}>+</button>
          <button className="micro" title="Rename" onClick={(e) => { e.stopPropagation(); rename(); }}>✎</button>
        </span>
      </div>
      {node.children.length > 0 && (
        <ul className="skos-children">
          {node.children.map((c) => (
            <ConceptTreeNode key={c.iri} node={c} depth={depth + 1} rows={rows} scheme={scheme} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TaxonomyPanel() {
  const conn = useConnection();
  const [schemes, setSchemes] = useState<SchemeInfo[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [rows, setRows] = useState<ConceptRow[]>([]);
  const [rootOver, setRootOver] = useState(false);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const ep = conn.active();
    if (!ep) return;
    let cancelled = false;
    listSchemes(ep, conn.activeGraph).then((s) => {
      if (cancelled) return;
      setSchemes(s);
      setActive((a) => a ?? s[0]?.iri ?? null);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.activeId, conn.activeGraph, nonce]);

  useEffect(() => {
    const ep = conn.active();
    if (!ep || !active) {
      setRows([]);
      return;
    }
    let cancelled = false;
    fetchConcepts(ep, conn.activeGraph, active).then((r) => !cancelled && setRows(r));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, conn.activeId, conn.activeGraph, nonce]);

  const newScheme = useCallback(() => {
    openAssetDialog({
      asset: 'scheme',
      title: 'New concept scheme',
      onDone: (iri) => {
        setActive(iri);
        refresh();
      },
    });
  }, [refresh]);

  const addTop = useCallback(() => {
    if (!active) return;
    openAssetDialog({ asset: 'concept', title: 'New top concept', scheme: active, onDone: refresh });
  }, [active, refresh]);

  const dropToTop = useCallback(
    async (droppedIri: string) => {
      const ep = conn.active();
      if (!ep || !active) return;
      const row = rows.find((r) => r.iri === droppedIri);
      if (!row || row.broader === null) return;
      await cmdReparentConcept(ep, conn.activeGraph, {
        concept: droppedIri,
        scheme: active,
        oldBroader: row.broader,
        newBroader: null,
      });
      refresh();
    },
    [conn, active, rows, refresh]
  );

  if (conn.status !== 'connected') return <div className="placeholder">Connect to an endpoint to browse</div>;
  if (!schemes) return <div className="tree-loading">loading schemes…</div>;

  const tree = buildTaxonomyTree(rows);

  return (
    <div className="taxonomy-panel">
      <div className="skos-toolbar">
        <select value={active ?? ''} onChange={(e) => setActive(e.target.value || null)} style={{ flex: 1 }}>
          {schemes.length === 0 && <option value="">no schemes yet</option>}
          {schemes.map((s) => (
            <option key={s.iri} value={s.iri}>
              {displayName(s.iri, s.label)} ({s.conceptCount})
            </option>
          ))}
        </select>
        <button className="ghost" onClick={newScheme} title="Create a concept scheme">＋ Scheme</button>
        <button className="ghost" onClick={openExtensions} title="Configure custom fields for concepts and schemes">⚙</button>
        <button
          className="ghost"
          disabled={!active}
          onClick={() => active && openCsvImport(active, refresh)}
          title="Bulk import concepts from a CSV spreadsheet"
        >
          ⇪ CSV
        </button>
      </div>
      {active && (
        <>
          <div
            className={`skos-root ${rootOver ? 'drop-target' : ''}`}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(CONCEPT_MIME)) {
                e.preventDefault();
                setRootOver(true);
              }
            }}
            onDragLeave={() => setRootOver(false)}
            onDrop={(e) => {
              setRootOver(false);
              const iri = e.dataTransfer.getData(CONCEPT_MIME);
              if (iri) dropToTop(iri);
            }}
          >
            <span className="term-meta">top concepts — drop here to promote</span>
            <button className="micro" title="Add top concept" onClick={addTop}>+</button>
          </div>
          <ul className="skos-tree">
            {tree.map((n) => (
              <ConceptTreeNode key={n.iri} node={n} depth={0} rows={rows} scheme={active} onChanged={refresh} />
            ))}
            {tree.length === 0 && <li className="tree-loading">no concepts — add a top concept</li>}
          </ul>
        </>
      )}
    </div>
  );
}
