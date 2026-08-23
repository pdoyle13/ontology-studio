// Modal primitives: a promise-based confirm dialog + the shape-driven
// create-instance dialog (fields generated from the class's SHACL shape —
// required markers, typed widgets, instance pickers).

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useConnection } from '../state/connection';
import { useGraph } from '../state/graph';
import { fetchShapesForClasses, type PropertyShapeInfo } from '../rdf/shacl';
import { widgetFor, validateAgainstShape } from '../rdf/constraints';
import { cmdCreateInstanceFull } from '../rdf/commands';
import { displayName, humanize } from '../rdf/display';
import { localName } from '../rdf/prefixes';
import { ResourcePicker } from './ResourcePicker';

// ---------------- confirm ----------------

interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  danger: boolean;
  resolve: ((ok: boolean) => void) | null;
}

const useConfirm = create<ConfirmState>(() => ({ open: false, title: '', message: '', danger: false, resolve: null }));

/** Promise-based confirm — drop-in for window.confirm. */
export function confirmDialog(title: string, message: string, danger = true): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirm.setState({ open: true, title, message, danger, resolve });
  });
}

function ConfirmModal() {
  const { open, title, message, danger, resolve } = useConfirm();
  if (!open) return null;
  const done = (ok: boolean) => {
    resolve?.(ok);
    useConfirm.setState({ open: false, resolve: null });
  };
  return (
    <div className="modal-overlay" onClick={() => done(false)}>
      <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div style={{ marginBottom: 14 }}>{message}</div>
        <div className="modal-row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={() => done(false)}>Cancel</button>
          <button className={danger ? 'danger-text' : ''} autoFocus onClick={() => done(true)}>
            {danger ? 'Delete' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- shape-driven create instance ----------------

interface CreateState {
  classIri: string | null;
}

export const useCreateDialog = create<CreateState>(() => ({ classIri: null }));
export const openCreateInstance = (classIri: string) => useCreateDialog.setState({ classIri });

function CreateInstanceDialog() {
  const classIri = useCreateDialog((s) => s.classIri);
  const conn = useConnection();
  const { prefixes, loadClasses, selectResource } = useGraph();
  const [shapeProps, setShapeProps] = useState<PropertyShapeInfo[]>([]);
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [pickerFor, setPickerFor] = useState<PropertyShapeInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName('');
    setLabel('');
    setValues({});
    setError('');
    setShapeProps([]);
    const ep = conn.active();
    if (!classIri || !ep) return;
    fetchShapesForClasses(ep, conn.activeGraph, [classIri])
      .then((shapes) => setShapeProps(shapes[0]?.properties ?? []))
      .catch(() => setShapeProps([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classIri]);

  if (!classIri) return null;
  const close = () => useCreateDialog.setState({ classIri: null });

  const createNow = async () => {
    const ep = conn.active();
    if (!ep || !name.trim()) return;
    // validate all filled fields against their shapes first
    for (const ps of shapeProps) {
      const v = values[ps.path]?.trim();
      if (!v) {
        if ((ps.minCount ?? 0) >= 1) {
          setError(`${ps.name ?? humanize(localName(ps.path))} is required`);
          return;
        }
        continue;
      }
      if (widgetFor(ps) !== 'iri') {
        const err = validateAgainstShape(ps, v);
        if (err) {
          setError(`${ps.name ?? humanize(localName(ps.path))}: ${err}`);
          return;
        }
      }
    }
    setBusy(true);
    setError('');
    try {
      const ns = classIri.replace(/[^#/]+$/, '');
      const iri = ns + name.trim().replace(/\s+/g, '');
      const props = shapeProps
        .filter((ps) => values[ps.path]?.trim())
        .map((ps) => ({
          predicate: ps.path,
          value: values[ps.path].trim(),
          isIri: widgetFor(ps) === 'iri',
          datatype: ps.datatype ?? undefined,
        }));
      await cmdCreateInstanceFull(ep, conn.activeGraph, iri, classIri, label.trim() || undefined, props);
      await loadClasses();
      await selectResource(iri);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">New {displayName(classIri)}</div>
        <label className="field-label">Local name *</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="MyNewThing" style={{ width: '100%' }} />
        <label className="field-label">Label</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: '100%' }} />
        {shapeProps.map((ps) => {
          const w = widgetFor(ps);
          const required = (ps.minCount ?? 0) >= 1;
          const title = `${ps.name ?? humanize(localName(ps.path))}${required ? ' *' : ''}`;
          return (
            <div key={ps.path}>
              <label className="field-label" title={ps.description ?? ps.path}>
                {title} <span className="term-meta">{ps.datatype ? prefixes.shrink(ps.datatype) : ps.classIri ? `→ ${displayName(ps.classIri)}` : ''}</span>
              </label>
              {w === 'iri' ? (
                pickerFor?.path === ps.path ? (
                  <ResourcePicker
                    classIri={ps.classIri}
                    onPick={(iri) => {
                      setValues((v) => ({ ...v, [ps.path]: iri }));
                      setPickerFor(null);
                    }}
                    onCancel={() => setPickerFor(null)}
                  />
                ) : (
                  <button className="ghost" style={{ width: '100%', textAlign: 'left' }} onClick={() => setPickerFor(ps)}>
                    {values[ps.path] ? displayName(values[ps.path]) : 'pick…'}
                  </button>
                )
              ) : w === 'enum' && ps.inValues ? (
                <select value={values[ps.path] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [ps.path]: e.target.value }))} style={{ width: '100%' }}>
                  <option value="">—</option>
                  {ps.inValues.map((iv) => (
                    <option key={iv.value} value={iv.value}>{iv.value}</option>
                  ))}
                </select>
              ) : w === 'boolean' ? (
                <select value={values[ps.path] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [ps.path]: e.target.value }))} style={{ width: '100%' }}>
                  <option value="">—</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  type={w === 'number' ? 'number' : w === 'date' ? 'date' : w === 'datetime' ? 'datetime-local' : 'text'}
                  value={values[ps.path] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [ps.path]: e.target.value }))}
                  style={{ width: '100%' }}
                />
              )}
            </div>
          );
        })}
        {shapeProps.length === 0 && <div className="term-meta" style={{ marginTop: 6 }}>No shape for this class — name and label only. (Generate a shape for a full form.)</div>}
        {error && <div className="err-text" style={{ marginTop: 8 }}>{error}</div>}
        <div className="modal-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={close}>Cancel</button>
          <button disabled={!name.trim() || busy} onClick={createNow}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Modals() {
  return (
    <>
      <ConfirmModal />
      <CreateInstanceDialog />
    </>
  );
}
