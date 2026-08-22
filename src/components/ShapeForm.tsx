// Shape-driven form: renders a resource's fields from the SHACL property shapes
// of its class(es) — ordered, named, cardinality-aware. The DASH pattern.

import { useEffect, useState } from 'react';
import { useGraph } from '../state/graph';
import { useConnection } from '../state/connection';
import type { ResourceDescription, TermValue } from '../rdf/queries';
import { fetchInstances, type InstanceInfo } from '../rdf/queries';
import { fetchShapesForClasses, datatypeToKind, type NodeShapeInfo, type PropertyShapeInfo } from '../rdf/shacl';
import { parseTermInput } from '../rdf/mutations';
import { cmdInsert, cmdDelete, cmdReplace } from '../rdf/commands';
import { useValidation } from '../state/validation';

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
  const { prefixes, selectResource } = useGraph();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  if (editing && value.type === 'literal') {
    const save = () => {
      if (!ep) return;
      run(() => cmdReplace(ep, graph, subject, ps.path, value, { ...value, value: text }));
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
          <button className="micro" onClick={save}>✓</button>
          <button className="micro" onClick={() => setEditing(false)}>✕</button>
        </span>
      </div>
    );
  }
  return (
    <div className="value-row">
      {value.type === 'uri' ? (
        <a className="term-link" title={value.value} onClick={() => selectResource(value.value)}>
          {value.label ?? prefixes.shrink(value.value)}
        </a>
      ) : (
        <span className="term-literal">{value.value}</span>
      )}
      <span className="row-actions">
        {value.type === 'literal' && (
          <button className="micro" title="Edit" onClick={() => { setText(value.value); setEditing(true); }}>✎</button>
        )}
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
  const conn = useConnection();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [options, setOptions] = useState<InstanceInfo[] | null>(null);

  useEffect(() => {
    if (!open || !ps.classIri) return;
    const ep2 = conn.active();
    if (!ep2) return;
    fetchInstances(ep2, conn.activeGraph, ps.classIri, '', 100).then(setOptions).catch(() => setOptions(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ps.classIri]);

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

  if (ps.classIri && options) {
    return (
      <div className="value-row">
        <select
          autoFocus
          onChange={(e) => e.target.value && saveTerm({ type: 'uri', value: e.target.value })}
          defaultValue=""
        >
          <option value="" disabled>
            select {prefixes.shrink(ps.classIri)}…
          </option>
          {options.map((o) => (
            <option key={o.iri} value={o.iri}>
              {o.label ?? prefixes.shrink(o.iri)}
            </option>
          ))}
        </select>
        <button className="micro" onClick={() => setOpen(false)}>✕</button>
      </div>
    );
  }

  const kind = ps.classIri ? 'iri' : datatypeToKind(ps.datatype);
  const save = () => {
    if (!text.trim()) return;
    const term = parseTermInput(text, kind, (s) => prefixes.expand(s));
    if (ps.datatype && term.type === 'literal') term.datatype = ps.datatype;
    saveTerm(term);
  };
  return (
    <div className="value-row">
      <input
        autoFocus
        placeholder={kind === 'iri' ? 'IRI or curie' : kind}
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
