// Assets tab: every asset type from the registry, rendered by its declared
// presentation. Built-ins pull live from their home surfaces (catalog for
// physical objects, alignment for business objects, mappings graph for
// R2RML); custom types list instances of their class with shape-driven
// creation. Nothing here is per-type code beyond the presentation renderers.

import { useCallback, useEffect, useState } from 'react';
import { useConnection } from '../state/connection';
import { useGraph } from '../state/graph';
import { listAssetTypes, cmdCreateAssetType, cmdDeleteAssetType, type AssetTypeDef, type Presentation } from '../rdf/assetTypes';
import { fetchInstances, type InstanceInfo } from '../rdf/queries';
import { select } from '../rdf/sparqlClient';
import { displayName, humanize } from '../rdf/display';
import { openCreateInstance, confirmDialog } from './Modal';
import { openImportWizard } from './ImportWizard';
import { openDataGrid } from './DataGrid';
import { TaxonomyPanel } from './TaxonomyPanel';
import { dragIri } from './ClassTree';

const STUDIO = 'https://studio.local/ns#';
const RR = 'http://www.w3.org/ns/r2rml#';

interface CatalogEntry {
  classIri: string;
  sourceId: string;
  table: string;
  rowCount?: number;
  businessArea?: string | null;
}

/** Catalog-backed built-ins: physical objects, business objects, mappings. */
function CatalogList({ type }: { type: AssetTypeDef }) {
  const { selectResource, selected } = useGraph();
  const [rows, setRows] = useState<{ iri: string; label: string; detail: string }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (type.classIri === `${RR}TriplesMap`) {
          const ep = useConnection.getState().active();
          if (!ep) return;
          const r = await select(
            ep,
            `SELECT ?tm ?table WHERE { GRAPH <https://studio.local/graphs/mappings> { ?tm a <${RR}TriplesMap> . OPTIONAL { ?tm <${RR}logicalTable>/<${RR}tableName> ?table } } } ORDER BY ?table`
          );
          if (!cancelled)
            setRows(
              r.bindings.filter((b) => b.tm).map((b) => ({
                iri: b.tm.value,
                label: b.table?.value ? `${b.table.value} → mapping` : displayName(b.tm.value),
                detail: 'R2RML',
              }))
            );
          return;
        }
        const cat: CatalogEntry[] = await fetch('/api/virtual/classes').then((r) => r.json());
        if (cancelled) return;
        if (type.classIri === `${STUDIO}PhysicalObject`) {
          setRows(cat.map((c) => ({ iri: c.classIri, label: c.table, detail: `${c.sourceId} · ${c.rowCount ?? 0} rows` })));
        } else {
          // business objects: catalog classes with a business-area alignment
          setRows(
            cat
              .filter((c) => c.businessArea)
              .map((c) => ({ iri: c.classIri, label: humanize(c.table), detail: `${c.businessArea} · ${c.sourceId}` }))
          );
        }
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [type.classIri]);

  if (!rows) return <div className="tree-loading">loading…</div>;
  if (rows.length === 0) return <div className="term-meta">none yet</div>;
  return (
    <ul className="instance-list" style={{ marginLeft: 0, borderLeft: 'none' }}>
      {rows.map((r) => (
        <li
          key={r.iri + r.label}
          className={selected === r.iri ? 'selected' : ''}
          title={r.iri}
          draggable
          onDragStart={(e) => dragIri(e, r.iri)}
          onClick={() => selectResource(r.iri)}
        >
          {r.label}
          <span className="count" style={{ marginLeft: 6 }}>{r.detail}</span>
          {type.classIri === `${STUDIO}PhysicalObject` && (
            <button
              className="micro"
              title="Browse live data (grid)"
              onClick={(e) => {
                e.stopPropagation();
                openDataGrid(r.iri);
              }}
            >
              ⊞
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Class-instance types (glossaries + custom): list + shape-driven create. */
function InstanceList({ type }: { type: AssetTypeDef }) {
  const conn = useConnection();
  const { selectResource, selected } = useGraph();
  const [items, setItems] = useState<InstanceInfo[] | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const ep = conn.active();
    if (!ep) return;
    let cancelled = false;
    fetchInstances(ep, conn.activeGraph, type.classIri).then((r) => !cancelled && setItems(r)).catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type.classIri, conn.activeId, conn.activeGraph, nonce]);

  return (
    <>
      <button className="micro add-field" onClick={() => openCreateInstance(type.classIri)} title={`New ${type.label.replace(/s$/, '').toLowerCase()}`}>
        + new
      </button>
      <button className="micro" style={{ marginLeft: 4 }} title="Import from spreadsheet" onClick={() => openImportWizard(type.classIri, () => setNonce((n) => n + 1))}>⇪</button>
      <button className="micro" style={{ marginLeft: 4 }} title="Refresh" onClick={() => setNonce((n) => n + 1)}>⟳</button>
      {!items ? (
        <div className="tree-loading">loading…</div>
      ) : items.length === 0 ? (
        <div className="term-meta">none yet</div>
      ) : (
        <ul className="instance-list" style={{ marginLeft: 0, borderLeft: 'none' }}>
          {items.map((i) => (
            <li
              key={i.iri}
              className={selected === i.iri ? 'selected' : ''}
              title={i.iri}
              draggable
              onDragStart={(e) => dragIri(e, i.iri)}
              onClick={() => selectResource(i.iri)}
            >
              {displayName(i.iri, i.label)}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function NewTypeForm({ onDone }: { onDone: () => void }) {
  const conn = useConnection();
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [presentation, setPresentation] = useState<Presentation>('list');
  const [error, setError] = useState('');

  const createIt = async () => {
    const ep = conn.active();
    if (!ep || !label.trim()) return;
    try {
      await cmdCreateAssetType(ep, { label: label.trim(), description, presentation });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="ext-form" style={{ marginTop: 6 }}>
      <label className="field-label">Type name *</label>
      <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Data Domains, Requirements, KPIs" style={{ width: '100%' }} />
      <label className="field-label">Description</label>
      <input value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%' }} />
      <label className="field-label">Presentation</label>
      <select value={presentation} onChange={(e) => setPresentation(e.target.value as Presentation)} style={{ width: '100%' }}>
        <option value="list">flat list</option>
        <option value="tree">tree (broader/narrower)</option>
      </select>
      {error && <div className="err-text">{error}</div>}
      <div className="modal-row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onDone}>Cancel</button>
        <button disabled={!label.trim()} onClick={createIt}>Create type</button>
      </div>
    </div>
  );
}

export function AssetsPanel() {
  const conn = useConnection();
  const [types, setTypes] = useState<AssetTypeDef[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const ep = conn.active();
    if (!ep) return;
    let cancelled = false;
    listAssetTypes(ep).then((t) => !cancelled && setTypes(t));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.activeId, conn.activeGraph, nonce]);

  if (conn.status !== 'connected') return <div className="placeholder">Connect to an endpoint to browse</div>;
  if (!types) return <div className="tree-loading">loading asset types…</div>;

  const removeType = async (t: AssetTypeDef) => {
    const ep = conn.active();
    if (!ep) return;
    if (!(await confirmDialog('Delete asset type', `Delete the “${t.label}” type? Its instances stay in the graph.`))) return;
    await cmdDeleteAssetType(ep, t.iri);
    refresh();
  };

  return (
    <div className="assets-panel">
      {types.map((t) => {
        const isOpen = open.has(t.iri);
        return (
          <div key={t.iri} className="asset-type">
            <div
              className="class-row"
              title={t.description ?? t.classIri}
              onClick={() => {
                const next = new Set(open);
                if (isOpen) next.delete(t.iri);
                else next.add(t.iri);
                setOpen(next);
              }}
            >
              <span className="twisty">{isOpen ? '▾' : '▸'}</span>
              <span className="class-name">{t.label}</span>
              {!t.builtin && (
                <button className="micro danger" title="Delete this asset type" onClick={(e) => { e.stopPropagation(); removeType(t); }}>
                  ✕
                </button>
              )}
              <span className="count">{t.builtin ? '' : 'custom'}</span>
            </div>
            {isOpen && (
              <div className="asset-body">
                {t.presentation === 'tree' && t.builtin ? (
                  <TaxonomyPanel />
                ) : t.presentation === 'catalog' ? (
                  <CatalogList type={t} />
                ) : (
                  <InstanceList type={t} />
                )}
              </div>
            )}
          </div>
        );
      })}
      {adding ? (
        <NewTypeForm
          onDone={() => {
            setAdding(false);
            refresh();
          }}
        />
      ) : (
        <button className="ghost" style={{ marginTop: 8 }} onClick={() => setAdding(true)}>
          ＋ New asset type…
        </button>
      )}
    </div>
  );
}
