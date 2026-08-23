// Extensions configurator: define custom fields per asset type. Each field is
// written as a named SHACL property shape in the extensions graph — the create
// dialogs, validation, and CSV import pick them up automatically.

import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import { useConnection } from '../state/connection';
import type { PropertyShapeInfo } from '../rdf/shacl';
import {
  fetchCustomFields,
  cmdAddCustomField,
  cmdRemoveCustomField,
  customFieldPsIri,
  type AssetType,
  type FieldKind,
} from '../rdf/skosExt';
import { confirmDialog } from './Modal';

interface ExtState {
  open: boolean;
}
export const useExtensions = create<ExtState>(() => ({ open: false }));
export const openExtensions = () => useExtensions.setState({ open: true });

const KINDS: { id: FieldKind; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'multiline', label: 'Long text' },
  { id: 'langtext', label: 'Language-tagged text' },
  { id: 'number', label: 'Number' },
  { id: 'date', label: 'Date' },
  { id: 'boolean', label: 'Yes / no' },
  { id: 'enum', label: 'Pick list' },
];

function AssetSection({ asset, title }: { asset: AssetType; title: string }) {
  const conn = useConnection();
  const [fields, setFields] = useState<PropertyShapeInfo[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<FieldKind>('text');
  const [required, setRequired] = useState(false);
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    const ep = conn.active();
    if (!ep) return;
    fetchCustomFields(ep, asset).then(setFields).catch(() => setFields([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, conn.activeId]);

  useEffect(refresh, [refresh]);

  const add = async () => {
    const ep = conn.active();
    if (!ep || !label.trim()) return;
    if (kind === 'enum' && !options.trim()) {
      setError('a pick list needs options (separate with |)');
      return;
    }
    setError('');
    try {
      await cmdAddCustomField(ep, asset, {
        label: label.trim(),
        kind,
        required,
        description: description.trim() || undefined,
        options: kind === 'enum' ? options.split('|').map((o) => o.trim()).filter(Boolean) : undefined,
        path: path.trim() || undefined,
      });
      setLabel('');
      setDescription('');
      setOptions('');
      setPath('');
      setRequired(false);
      setAdding(false);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (f: PropertyShapeInfo) => {
    const ep = conn.active();
    if (!ep || !f.name) return;
    if (!(await confirmDialog('Remove custom field', `Remove “${f.name}”? Existing values on assets stay in the graph.`))) return;
    await cmdRemoveCustomField(ep, asset, customFieldPsIri(asset, f.name));
    refresh();
  };

  return (
    <div className="ext-section">
      <div className="panel-title">{title}</div>
      {!fields && <div className="tree-loading">loading…</div>}
      {fields && fields.length === 0 && <div className="term-meta">No custom fields yet.</div>}
      <ul className="ext-list">
        {fields?.map((f) => (
          <li key={f.path} className="ext-row">
            <span className="ext-name" title={f.path}>{f.name}</span>
            <span className="term-meta">
              {f.inValues ? `pick: ${f.inValues.map((v) => v.value).join(' | ')}` : (f.datatype ?? '').split('#').pop()}
              {f.singleLine === false ? ' · long' : ''}
              {(f.minCount ?? 0) >= 1 ? ' · required' : ''}
            </span>
            <button className="micro danger" title="Remove field" onClick={() => remove(f)}>✕</button>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="ext-form">
          <label className="field-label">Field name *</label>
          <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Steward, Status, Source system" style={{ width: '100%' }} />
          <label className="field-label">Type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as FieldKind)} style={{ width: '100%' }}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
          {kind === 'enum' && (
            <>
              <label className="field-label">Options (separate with |)</label>
              <input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="draft | approved | deprecated" style={{ width: '100%' }} />
            </>
          )}
          <label className="field-label">Help text</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%' }} />
          <label className="field-label">Property IRI <span className="term-meta">optional — reuse e.g. skos:editorialNote; blank mints one</span></label>
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="http://www.w3.org/2004/02/skos/core#editorialNote" style={{ width: '100%' }} />
          <label className="field-label" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> required
          </label>
          {error && <div className="err-text">{error}</div>}
          <div className="modal-row" style={{ justifyContent: 'flex-end' }}>
            <button onClick={() => setAdding(false)}>Cancel</button>
            <button disabled={!label.trim()} onClick={add}>Add field</button>
          </div>
        </div>
      ) : (
        <button className="ghost" onClick={() => setAdding(true)}>＋ Add custom field</button>
      )}
    </div>
  );
}

export function ExtensionsDialog() {
  const open = useExtensions((s) => s.open);
  if (!open) return null;
  const close = () => useExtensions.setState({ open: false });
  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" style={{ width: 520, maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Taxonomy extensions</div>
        <div className="term-meta" style={{ marginBottom: 10 }}>
          Custom fields become SHACL property shapes in the extensions graph — create dialogs and imports pick them up automatically.
        </div>
        <AssetSection asset="concept" title="Concept fields" />
        <AssetSection asset="scheme" title="Scheme fields" />
        <div className="modal-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}
