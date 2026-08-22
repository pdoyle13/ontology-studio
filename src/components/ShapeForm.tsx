// Shape-driven form: renders a resource's fields from the SHACL property shapes
// of its class(es) — ordered, named, cardinality-aware. The DASH pattern.

import { useEffect, useState } from 'react';
import { useGraph } from '../state/graph';
import { useConnection } from '../state/connection';
import type { ResourceDescription, TermValue } from '../rdf/queries';
import { fetchShapesForClasses, datatypeToKind, type NodeShapeInfo, type PropertyShapeInfo } from '../rdf/shacl';
import { ResourcePicker } from './ResourcePicker';
import { displayName } from '../rdf/display';
import { parseTermInput } from '../rdf/mutations';
import { cmdInsert, cmdDelete, cmdReplace } from '../rdf/commands';
import { useValidation } from '../state/validation';
import { widgetFor, validateAgainstShape } from '../rdf/constraints';

function useWrite() {
  const conn = useConnection();
  const { refreshSelected } = useGraph();
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      await refreshSelected();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return { run, error, ep: conn.active(), graph: conn.activeGraph };
}

/** Constraint-aware literal input: right widget for the datatype, live validation. */
function ConstrainedInput({
  ps,
  text,
  setText,
  onSave,
  onCancel,
}: {
  ps: PropertyShapeInfo;
  text: string;
  setText: (s: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const widget = widgetFor(ps);
  const error = text.trim() ? validateAgainstShape(ps, text) : null;
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !error) onSave();
    if (e.key === 'Escape') onCancel();
  };
  return (
    <>
      {widget === 'enum' && ps.inValues ? (
        <select autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keys}>
          <option value="" disabled>
            select…
          </option>
          {ps.inValues.map((iv) => (
            <option key={iv.value} value={iv.value}>
              {iv.value}
            </option>
          ))}
        </select>
      ) : widget === 'boolean' ? (
        <select autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keys}>
          <option value="" disabled>
            select…
          </option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input
          autoFocus
          type={widget === 'number' ? 'number' : widget === 'date' ? 'date' : widget === 'datetime' ? 'datetime-local' : 'text'}
          min={ps.minInclusive ?? undefined}
          max={ps.maxInclusive ?? undefined}
          step={ps.datatype?.endsWith('integer') ? 1 : undefined}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={keys}
          className={error ? 'input-invalid' : ''}
          style={{ width: '100%' }}
        />
      )}
      <span className="row-actions always">
        <button className="micro" onClick={onSave} disabled={!!error || !text.trim()} title={error ?? 'Save'}>
          ✓
        </button>
        <button className="micro" onClick={onCancel}>✕</button>
      </span>
      {error && <span className="missing-note" style={{ flexBasis: '100%' }}>{error}</span>}
    </>
  );
}

function FieldValue({
  subject,
  ps,
  value,
}: {
  subject: string;
  ps: PropertyShapeInfo;
  value: TermValue;
}) {
  const { run, ep, graph } = useWrite();
  const { selectResource } = useGraph();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  if (editing && value.type === 'literal') {
    const save = () => {
      if (!ep || validateAgainstShape(ps, text)) return;
      run(() => cmdReplace(ep, graph, subject, ps.path, value, { ...value, value: text.trim() }));
      setEditing(false);
    };
    return (
      <div className="value-row">
        <ConstrainedInput ps={ps} text={text} setText={setText} onSave={save} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  // object value: replace via searchable dropdown of existing instances
  if (editing && value.type === 'uri') {
    return (
      <ResourcePicker
        classIri={ps.classIri}
        onPick={(iri) => {
          if (!ep) return;
          run(() => cmdReplace(ep, graph, subject, ps.path, value, { type: 'uri', value: iri }));
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }
  return (
    <div className="value-row">
      {value.type === 'uri' ? (
        <a className="term-link" title={value.value} onClick={() => selectResource(value.value)}>
          {displayName(value.value, value.label)}
        </a>
      ) : (
        <span className="term-literal">{value.value}</span>
      )}
      <span className="row-actions">
        <button className="micro" title="Edit" onClick={() => { setText(value.type === 'literal' ? value.value : ''); setEditing(true); }}>✎</button>
        <button
          className="micro danger"
          title="Remove"
          onClick={() => ep && run(() => cmdDelete(ep, graph, subject, ps.path, value))}
        >
          ✕
        </button>
      </span>
    </div>
  );
}

function FieldAdd({ subject, ps }: { subject: string; ps: PropertyShapeInfo }) {
  const { run, ep, graph } = useWrite();
  const { prefixes } = useGraph();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  if (!open) {
    return (
      <button className="micro add-field" onClick={() => setOpen(true)}>
        + add
      </button>
    );
  }

  const saveTerm = (term: TermValue) => {
    if (!ep) return;
    run(() => cmdInsert(ep, graph, subject, ps.path, term));
    setText('');
    setOpen(false);
  };

  // object property → searchable dropdown of existing instances
  if (widgetFor(ps) === 'iri') {
    return (
      <ResourcePicker
        classIri={ps.classIri}
        onPick={(iri) => saveTerm({ type: 'uri', value: iri })}
        onCancel={() => setOpen(false)}
      />
    );
  }

  const save = () => {
    if (!text.trim() || validateAgainstShape(ps, text)) return;
    const term = parseTermInput(text, datatypeToKind(ps.datatype), (s) => prefixes.expand(s));
    if (ps.datatype && term.type === 'literal') term.datatype = ps.datatype;
    saveTerm(term);
  };
  return (
    <div className="value-row">
      <ConstrainedInput ps={ps} text={text} setText={setText} onSave={save} onCancel={() => setOpen(false)} />
    </div>
  );
}

export function ShapeForm({ description }: { description: ResourceDescription }) {
  const conn = useConnection();
  const { prefixes, selectResource } = useGraph();
  const allViolations = useValidation((s) => s.violations);
  const myViolations = allViolations.filter((v) => v.focusNode === description.iri);
  const [shapes, setShapes] = useState<NodeShapeInfo[] | null>(null);

  useEffect(() => {
    const ep = conn.active();
    if (!ep || description.types.length === 0) {
      setShapes([]);
      return;
    }
    let cancelled = false;
    fetchShapesForClasses(ep, conn.activeGraph, description.types).then((s) => {
      if (!cancelled) setShapes(s);
    }).catch(() => !cancelled && setShapes([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description.iri, description.types.join(','), conn.activeId, conn.activeGraph]);

  if (!shapes || shapes.length === 0) return null;

  const valuesFor = (path: string): TermValue[] =>
    description.outgoing.filter((s) => s.predicate === path).map((s) => s.object);

  return (
    <div className="shape-form">
      {shapes.map((shape) => (
        <div key={shape.iri} className="shape-block">
          <div className="panel-title">
            Form —{' '}
            <a className="term-link" onClick={() => selectResource(shape.iri)}>
              {prefixes.shrink(shape.iri)}
            </a>
          </div>
          {shape.properties.map((ps) => {
            const vals = valuesFor(ps.path);
            const required = (ps.minCount ?? 0) >= 1;
            const missing = required && vals.length === 0;
            const canAdd = ps.maxCount === null || vals.length < ps.maxCount;
            const fieldViolations = myViolations.filter((v) => v.path === ps.path);
            return (
              <div
                key={`${shape.iri}|${ps.path}`}
                className={`shape-field ${missing || fieldViolations.length > 0 ? 'missing' : ''}`}
              >
                <div className="field-name" title={ps.description ?? ps.path}>
                  {ps.name ?? prefixes.shrink(ps.path)}
                  {required && <span className="req" title="required (sh:minCount ≥ 1)">*</span>}
                  {ps.datatype && <span className="term-meta"> {prefixes.shrink(ps.datatype)}</span>}
                  {ps.classIri && <span className="term-meta"> → {prefixes.shrink(ps.classIri)}</span>}
                </div>
                {vals.map((v, i) => (
                  <FieldValue key={i} subject={description.iri} ps={ps} value={v} />
                ))}
                {missing && <div className="missing-note">required — no value</div>}
                {fieldViolations.map((v, i) => (
                  <div key={i} className="missing-note" title={v.sourceShape ?? ''}>
                    {v.severity !== 'Violation' ? `[${v.severity}] ` : ''}{v.message}
                  </div>
                ))}
                {canAdd && <FieldAdd subject={description.iri} ps={ps} />}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
