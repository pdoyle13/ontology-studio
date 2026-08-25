// Shared shape-driven create dialog for taxonomy assets (concepts, schemes).
// Fields = SKOS built-ins + the custom fields configured in the extensions
// graph — the dialog renders whatever the shapes say, nothing hardcoded.

import { useEffect, useState } from 'react';
import { CodelistSelect } from './CodelistSelect';
import { create } from 'zustand';
import { useConnection } from '../state/connection';
import type { PropertyShapeInfo } from '../rdf/shacl';
import { widgetFor, validateAgainstShape } from '../rdf/constraints';
import {
  fetchAssetFields,
  buildConceptTriples,
  cmdCreateConcepts,
  slug,
  type AssetType,
} from '../rdf/skosExt';
import { SKOS } from '../rdf/skos';
import { serializeTerm } from '../rdf/mutations';
import { displayName } from '../rdf/display';

interface AssetDialogState {
  open: boolean;
  nonce: number;
  asset: AssetType;
  title: string;
  scheme: string | null; // concept: owning scheme
  broader: string | null; // concept: parent (null = top concept)
  onDone: ((iri: string) => void) | null;
}

export const useAssetDialog = create<AssetDialogState>(() => ({
  open: false,
  nonce: 0,
  asset: 'concept',
  title: '',
  scheme: null,
  broader: null,
  onDone: null,
}));

export function openAssetDialog(opts: {
  asset: AssetType;
  title: string;
  scheme?: string | null;
  broader?: string | null;
  onDone?: (iri: string) => void;
}) {
  useAssetDialog.setState({
    open: true,
    nonce: useAssetDialog.getState().nonce + 1,
    asset: opts.asset,
    title: opts.title,
    scheme: opts.scheme ?? null,
    broader: opts.broader ?? null,
    onDone: opts.onDone ?? null,
  });
}

const PREF_LABEL = `${SKOS}prefLabel`;

export function AssetDialog() {
  const { open, nonce } = useAssetDialog();
  if (!open) return null;
  return <AssetDialogInner key={nonce} />;
}

function AssetDialogInner() {
  const { asset, title, scheme, broader, onDone } = useAssetDialog();
  const conn = useConnection();
  const [fields, setFields] = useState<PropertyShapeInfo[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ep = conn.active();
    if (!ep) return;
    fetchAssetFields(ep, asset).then(setFields).catch(() => setFields([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset]);

  const close = () => useAssetDialog.setState({ open: false, onDone: null });

  const createNow = async () => {
    const ep = conn.active();
    if (!ep || !fields) return;
    const pref = values[PREF_LABEL]?.trim();
    if (!pref) {
      setError('a preferred label is required');
      return;
    }
    for (const f of fields) {
      const raw = values[f.path]?.trim();
      if (!raw) {
        if ((f.minCount ?? 0) >= 1 && f.path !== PREF_LABEL) {
          setError(`${f.name ?? f.path} is required`);
          return;
        }
        continue;
      }
      const multi = f.maxCount === null;
      for (const part of multi ? raw.split('|') : [raw]) {
        const err = part.trim() ? validateAgainstShape(f, part.trim()) : null;
        if (err) {
          setError(`${f.name ?? f.path}: ${err}`);
          return;
        }
      }
    }
    setBusy(true);
    setError('');
    try {
      if (asset === 'scheme') {
        const iri = `https://studio.local/taxonomy/${slug(pref)}`;
        const t = [
          `<${iri}> a <${SKOS}ConceptScheme> .`,
          `<${iri}> <${SKOS}prefLabel> ${serializeTerm({ type: 'literal', value: pref })} .`,
        ];
        const def = values[`${SKOS}definition`]?.trim();
        if (def) t.push(`<${iri}> <${SKOS}definition> ${serializeTerm({ type: 'literal', value: def })} .`);
        // custom scheme fields
        for (const f of fields) {
          if (f.path.startsWith(SKOS)) continue;
          const v = values[f.path]?.trim();
          if (v) t.push(`<${iri}> <${f.path}> ${serializeTerm({ type: 'literal', value: v })} .`);
        }
        await cmdCreateConcepts(ep, conn.activeGraph, t, 'create concept scheme');
        onDone?.(iri);
      } else {
        if (!scheme) throw new Error('no scheme selected');
        const iri = `${scheme.replace(/[#/]$/, '')}/${slug(pref)}`;
        const vmap = new Map<string, string[]>();
        for (const f of fields) {
          const raw = values[f.path]?.trim();
          if (!raw) continue;
          vmap.set(f.path, f.maxCount === null ? raw.split('|').map((x) => x.trim()).filter(Boolean) : [raw]);
        }
        const triples = buildConceptTriples({ iri, scheme, broader, values: vmap }, fields);
        await cmdCreateConcepts(ep, conn.activeGraph, triples);
        onDone?.(iri);
      }
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" style={{ maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        {broader && (
          <div className="term-meta" style={{ marginBottom: 8 }}>
            narrower concept under <strong>{displayName(broader)}</strong>
          </div>
        )}
        {!fields && <div className="tree-loading">loading fields…</div>}
        {fields?.map((f) => {
          const w = widgetFor(f);
          const required = (f.minCount ?? 0) >= 1;
          const set = (v: string) => setValues((s) => ({ ...s, [f.path]: v }));
          return (
            <div key={f.path}>
              <label className="field-label" title={f.path}>
                {f.name ?? f.path}
                {required && <span className="req">*</span>}
                {!f.path.startsWith(SKOS) && <span className="term-meta"> custom</span>}
              </label>
              {f.description && <div className="field-help">{f.description}</div>}
              {f.codelist ? (
                <CodelistSelect scheme={f.codelist} value={values[f.path] ?? ''} onChange={set} />
              ) : w === 'enum' && f.inValues ? (
                <select value={values[f.path] ?? ''} onChange={(e) => set(e.target.value)} style={{ width: '100%' }}>
                  <option value="">—</option>
                  {f.inValues.map((iv) => (
                    <option key={iv.value} value={iv.value}>{iv.value}</option>
                  ))}
                </select>
              ) : w === 'boolean' ? (
                <select value={values[f.path] ?? ''} onChange={(e) => set(e.target.value)} style={{ width: '100%' }}>
                  <option value="">—</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : w === 'textarea' ? (
                <textarea className="field-textarea" rows={3} value={values[f.path] ?? ''} onChange={(e) => set(e.target.value)} />
              ) : (
                <input
                  autoFocus={f.path === PREF_LABEL}
                  type={w === 'number' ? 'number' : w === 'date' ? 'date' : 'text'}
                  value={values[f.path] ?? ''}
                  onChange={(e) => set(e.target.value)}
                  style={{ width: '100%' }}
                />
              )}
            </div>
          );
        })}
        {error && <div className="err-text" style={{ marginTop: 8 }}>{error}</div>}
        <div className="modal-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={close}>Cancel</button>
          <button disabled={busy || !values[PREF_LABEL]?.trim()} onClick={createNow}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
