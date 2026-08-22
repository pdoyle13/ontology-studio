import { useState } from 'react';
import { useGraph } from '../state/graph';
import { useConnection } from '../state/connection';
import type { TermValue } from '../rdf/queries';
import { localName } from '../rdf/prefixes';
import { displayName, humanize } from '../rdf/display';
import { parseTermInput } from '../rdf/mutations';
import { cmdInsert, cmdDelete, cmdReplace, cmdCreateResource, cmdDeleteResource } from '../rdf/commands';
import { ShapeForm } from './ShapeForm';
import { ShapeEditor } from './ShapeEditor';
import { cmdGenerateShape } from '../rdf/shapeGen';

function ObjectTerm({ t }: { t: TermValue }) {
  const { prefixes, selectResource } = useGraph();
  if (t.type === 'uri') {
    return (
      <a className="term-link" title={t.value} onClick={() => selectResource(t.value)}>
        {displayName(t.value, t.label)}
      </a>
    );
  }
  if (t.type === 'bnode') return <span className="term-bnode">_:{t.value}</span>;
  return (
    <span className="term-literal">
      "{t.value}"
      {t.lang && <span className="term-meta">@{t.lang}</span>}
      {t.datatype && t.datatype !== 'http://www.w3.org/2001/XMLSchema#string' && (
        <span className="term-meta">^^{prefixes.shrink(t.datatype)}</span>
      )}
    </span>
  );
}

function useWrite() {
  const conn = useConnection();
  const { refreshSelected } = useGraph();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    const ep = conn.active();
    if (!ep) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refreshSelected();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error, ep: conn.active(), graph: conn.activeGraph };
}

/** One value row: view mode with hover edit/delete, or inline edit mode. */
function ValueRow({ subject, predicate, object }: { subject: string; predicate: string; object: TermValue }) {
  const { run, ep, graph } = useWrite();
  const { prefixes } = useGraph();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  if (!editing) {
    return (
      <div className="value-row">
        <ObjectTerm t={object} />
        <span className="row-actions">
          {object.type === 'literal' && (
            <button
              className="micro"
              title="Edit"
              onClick={() => {
                setText(object.value);
                setEditing(true);
              }}
            >
              ✎
            </button>
          )}
          <button
            className="micro danger"
            title="Delete value"
            onClick={() => {
              if (!ep) return;
              run(() => cmdDelete(ep, graph, subject, predicate, object));
            }}
          >
            ✕
          </button>
        </span>
      </div>
    );
  }
  const save = () => {
    if (!ep) return;
    const newObj: TermValue = { ...object, value: text };
    run(() => cmdReplace(ep, graph, subject, predicate, object, newObj));
    setEditing(false);
  };
  return (
    <div className="value-row">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        style={{ width: '100%' }}
      />
      <span className="row-actions always">
        <button className="micro" title="Save" onClick={save}>✓</button>
        <button className="micro" title="Cancel" onClick={() => setEditing(false)}>✕</button>
      </span>
      <span className="term-meta" style={{ flexBasis: '100%' }}>
        {object.lang ? `@${object.lang}` : object.datatype ? `^^${prefixes.shrink(object.datatype)}` : 'plain string'} (kept)
      </span>
    </div>
  );
}

/** Add-a-value input under a predicate group. */
function AddValue({ subject, predicate }: { subject: string; predicate: string }) {
  const { run, ep, graph } = useWrite();
  const { prefixes } = useGraph();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  if (!open) {
    return (
      <button className="micro add" title="Add value" onClick={() => setOpen(true)}>
        +
      </button>
    );
  }
  const save = () => {
    if (!ep || !text.trim()) return;
    const term = parseTermInput(text, 'auto', (s) => prefixes.expand(s));
    run(() => cmdInsert(ep, graph, subject, predicate, term));
    setText('');
    setOpen(false);
  };
  return (
    <div className="value-row">
      <input
        autoFocus
        placeholder="value, curie, or IRI"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setOpen(false);
        }}
        style={{ width: '100%' }}
      />
      <span className="row-actions always">
        <button className="micro" onClick={save}>✓</button>
        <button className="micro" onClick={() => setOpen(false)}>✕</button>
      </span>
    </div>
  );
}

/** New property + value on the resource. */
function AddProperty({ subject }: { subject: string }) {
  const { run, ep, graph } = useWrite();
  const { prefixes } = useGraph();
  const [open, setOpen] = useState(false);
  const [pred, setPred] = useState('');
  const [val, setVal] = useState('');

  if (!open) {
    return (
      <button className="ghost" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
        + Add property
      </button>
    );
  }
  const save = () => {
    if (!ep || !pred.trim() || !val.trim()) return;
    const p = prefixes.expand(pred.trim());
    const term = parseTermInput(val, 'auto', (s) => prefixes.expand(s));
    run(() => cmdInsert(ep, graph, subject, p, term));
    setOpen(false);
    setPred('');
    setVal('');
  };
  return (
    <div className="add-prop">
      <input placeholder="predicate (curie or IRI)" value={pred} onChange={(e) => setPred(e.target.value)} />
      <input
        placeholder="value"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
      <span className="row-actions always">
        <button className="micro" onClick={save}>✓</button>
        <button className="micro" onClick={() => setOpen(false)}>✕</button>
      </span>
    </div>
  );
}

const CLASS_IRIS = new Set([
  'http://www.w3.org/2000/01/rdf-schema#Class',
  'http://www.w3.org/2002/07/owl#Class',
]);

export function ResourcePanel() {
  const { selected, description, descriptionLoading, prefixes, selectResource, loadClasses, error: loadError } = useGraph();
  const { run, ep, graph, busy, error: writeError } = useWrite();

  if (!selected) return <div className="placeholder">Select a resource to view its properties</div>;
  if (descriptionLoading && !description) return <div className="tree-loading">loading…</div>;
  if (!description) return <div className="placeholder">{loadError ?? 'Nothing loaded'}</div>;

  const d = description;
  const isClass = d.types.some((t) => CLASS_IRIS.has(t)) || d.incoming.some((s) => s.predicate === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
  const isNodeShape =
    d.types.includes('http://www.w3.org/ns/shacl#NodeShape') ||
    d.outgoing.some((s) => s.predicate === 'http://www.w3.org/ns/shacl#property');
  const hasShape = d.incoming.some((s) => s.predicate === 'http://www.w3.org/ns/shacl#targetClass');
  const grouped = new Map<string, TermValue[]>();
  for (const s of d.outgoing) {
    if (!grouped.has(s.predicate)) grouped.set(s.predicate, []);
    grouped.get(s.predicate)!.push(s.object);
  }

  const newInstance = () => {
    if (!ep) return;
    const ns = d.iri.replace(/[^#/]+$/, '');
    const name = window.prompt(`New instance of ${prefixes.shrink(d.iri)} — local name:`);
    if (!name) return;
    const iri = ns + name.trim().replace(/\s+/g, '');
    const label = window.prompt('Label (optional):') ?? undefined;
    run(async () => {
      await cmdCreateResource(ep, graph, iri, d.iri, label || undefined);
      await loadClasses();
      await selectResource(iri);
    });
  };

  const removeResource = () => {
    if (!ep) return;
    const refs = d.incomingTotal;
    const msg =
      refs > 0
        ? `Delete ${prefixes.shrink(d.iri)} AND ${refs} incoming reference(s)?`
        : `Delete ${prefixes.shrink(d.iri)}?`;
    if (!window.confirm(msg)) return;
    run(async () => {
      await cmdDeleteResource(ep, graph, d.iri, refs > 0);
      await loadClasses();
      await selectResource(null);
    });
  };

  return (
    <div className="resource-panel">
      <div className="resource-header">
        <div className="resource-title" title={d.iri}>
          {displayName(d.iri, d.label)}
        </div>
        <div className="resource-iri">{d.iri}</div>
        {d.types.length > 0 && (
          <div className="resource-types">
            {d.types.map((t) => (
              <span key={t} className="type-chip" title={t} onClick={() => selectResource(t)}>
                {prefixes.shrink(t)}
              </span>
            ))}
          </div>
        )}
        {d.virtual && (
          <div className="virtual-badge" title="Instance data is not in the graph - fetched live from the owning database">
            live · {d.virtual.sourceId}.{d.virtual.table}
          </div>
        )}
        <div className="resource-actions">
          {!d.virtual && isClass && (
            <button className="ghost" onClick={newInstance}>
              + New instance
            </button>
          )}
          {!d.virtual && isClass && !hasShape && (
            <button
              className="ghost"
              title="Profile instances of this class and draft a SHACL NodeShape"
              onClick={() => {
                if (!ep) return;
                run(async () => {
                  const shapeIri = await cmdGenerateShape(ep, graph, d.iri);
                  await selectResource(shapeIri);
                });
              }}
            >
              ⚙ Generate shape
            </button>
          )}
          {!d.virtual && (
            <button className="ghost danger-text" onClick={removeResource}>
              Delete
            </button>
          )}
          {busy && <span className="tree-loading">saving…</span>}
        </div>
        {writeError && <div className="err-text">{writeError}</div>}
      </div>

      {isNodeShape && <ShapeEditor shapeIri={d.iri} />}
      <ShapeForm description={d} />

      <details open className="triples-details">
        <summary className="panel-title" style={{ cursor: 'pointer' }}>All triples</summary>
      <table className="prop-table">
        <tbody>
          {[...grouped.entries()].map(([pred, objs]) => (
            <tr key={pred}>
              <td className="pred-cell" title={prefixes.shrink(pred)}>
                <a className="term-link" onClick={() => selectResource(pred)}>
                  {humanize(localName(pred))}
                </a>
              </td>
              <td className="obj-cell">
                {objs.map((o, i) =>
                  d.virtual ? (
                    <div key={`${pred}|${i}|${o.value}`} className="value-row">
                      <ObjectTerm t={o} />
                    </div>
                  ) : (
                    <ValueRow key={`${pred}|${i}|${o.value}`} subject={d.iri} predicate={pred} object={o} />
                  )
                )}
                {!d.virtual && <AddValue subject={d.iri} predicate={pred} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!d.virtual && <AddProperty subject={d.iri} />}
      </details>

      {d.incoming.length > 0 && (
        <>
          <div className="panel-title" style={{ marginTop: 14 }}>
            Referenced by ({d.incomingTotal})
          </div>
          <table className="prop-table">
            <tbody>
              {d.incoming.map((s, i) => (
                <tr key={i}>
                  <td className="pred-cell" title={s.predicate}>
                    ← {humanize(localName(s.predicate))}
                  </td>
                  <td className="obj-cell">
                    <a className="term-link" title={s.subject} onClick={() => selectResource(s.subject)}>
                      {s.subjectLabel ?? prefixes.shrink(s.subject)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
