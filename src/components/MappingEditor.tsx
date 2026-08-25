// Visual R2RML mapping editor: inspect and adjust one TriplesMap — subject
// template, and per-column predicate/datatype rows. Every action is a
// targeted DELETE/INSERT in the mappings graph, so the virtual layer,
// federation and GraphQL pick the change up on their next catalog read.

import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import { useConnection } from '../state/connection';
import { select, update } from '../rdf/sparqlClient';

const RR = 'http://www.w3.org/ns/r2rml#';
const G = 'https://studio.local/graphs/mappings';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const DATATYPES = ['', 'integer', 'decimal', 'double', 'boolean', 'date', 'dateTime'];

interface Pom {
  pom: string;
  om: string;
  predicate: string;
  column: string | null; // null → FK/template object map (IRI-valued)
  template: string | null;
  datatype: string | null;
}

interface MappingState {
  tm: string | null;
}

export const useMappingEditor = create<MappingState>(() => ({ tm: null }));
export const openMappingEditor = (tm: string) => useMappingEditor.setState({ tm });

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function MappingEditor() {
  const tm = useMappingEditor((s) => s.tm);
  const conn = useConnection();
  const [table, setTable] = useState('');
  const [template, setTemplate] = useState('');
  const [subjectMap, setSubjectMap] = useState('');
  const [klass, setKlass] = useState('');
  const [poms, setPoms] = useState<Pom[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newCol, setNewCol] = useState('');
  const [newPred, setNewPred] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const ep = conn.active();
    if (!ep || !tm) return;
    setError('');
    try {
      const head = await select(
        ep,
        `SELECT ?table ?sm ?tmpl ?cls WHERE { GRAPH <${G}> {
  <${tm}> <${RR}logicalTable>/<${RR}tableName> ?table ; <${RR}subjectMap> ?sm .
  ?sm <${RR}template> ?tmpl ; <${RR}class> ?cls } } LIMIT 1`
      );
      const h = head.bindings[0];
      setTable(h?.table?.value ?? '');
      setSubjectMap(h?.sm?.value ?? '');
      setTemplate(h?.tmpl?.value ?? '');
      setKlass(h?.cls?.value ?? '');
      const r = await select(
        ep,
        `SELECT ?pom ?pred ?om ?col ?tmpl ?dt WHERE { GRAPH <${G}> {
  <${tm}> <${RR}predicateObjectMap> ?pom .
  ?pom <${RR}predicate> ?pred ; <${RR}objectMap> ?om .
  OPTIONAL { ?om <${RR}column> ?col }
  OPTIONAL { ?om <${RR}template> ?tmpl }
  OPTIONAL { ?om <${RR}datatype> ?dt }
} } ORDER BY ?col ?pred`
      );
      const rows = r.bindings
        .filter((b) => b.pom && b.pred && b.om)
        .map((b) => ({
          pom: b.pom.value,
          om: b.om.value,
          predicate: b.pred.value,
          column: b.col?.value ?? null,
          template: b.tmpl?.value ?? null,
          datatype: b.dt?.value ?? null,
        }));
      setPoms(rows);
      setDrafts(Object.fromEntries(rows.map((p) => [p.pom, p.predicate])));
    } catch (e) {
      setError((e as Error).message);
      setPoms([]);
    }
  }, [conn, tm]);

  useEffect(() => {
    if (tm) load();
  }, [tm, load]);

  if (!tm) return null;
  const close = () => useMappingEditor.setState({ tm: null });
  const ep = conn.active();
  if (!ep) return null;

  const run = async (u: string) => {
    setError('');
    try {
      await update(ep, u);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const applyPredicate = (p: Pom) => {
    const next = drafts[p.pom]?.trim();
    if (!next || next === p.predicate) return;
    run(
      `DELETE DATA { GRAPH <${G}> { <${p.pom}> <${RR}predicate> <${p.predicate}> } } ;
INSERT DATA { GRAPH <${G}> { <${p.pom}> <${RR}predicate> <${next}> } }`
    );
  };

  const applyDatatype = (p: Pom, dtLocal: string) => {
    const next = dtLocal ? `${XSD}${dtLocal}` : null;
    if (next === p.datatype) return;
    const del = p.datatype ? `DELETE DATA { GRAPH <${G}> { <${p.om}> <${RR}datatype> <${p.datatype}> } } ;\n` : '';
    const ins = next ? `INSERT DATA { GRAPH <${G}> { <${p.om}> <${RR}datatype> <${next}> } }` : '';
    run(`${del}${ins}` || 'INSERT DATA { }');
  };

  const removePom = (p: Pom) => {
    run(
      `DELETE DATA { GRAPH <${G}> { <${tm}> <${RR}predicateObjectMap> <${p.pom}> } } ;
DELETE WHERE { GRAPH <${G}> { <${p.pom}> ?a ?b } } ;
DELETE WHERE { GRAPH <${G}> { <${p.om}> ?c ?d } }`
    );
  };

  const applyTemplate = () => {
    if (!template.trim() || !subjectMap) return;
    run(
      `DELETE WHERE { GRAPH <${G}> { <${subjectMap}> <${RR}template> ?t } } ;
INSERT DATA { GRAPH <${G}> { <${subjectMap}> <${RR}template> "${esc(template.trim())}" } }`
    );
  };

  const addPom = () => {
    const col = newCol.trim();
    const pred = newPred.trim();
    if (!col || !pred) return;
    const slug = col.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const suffix = `custom-${slug}-${Date.now().toString(36)}`;
    const pomIri = `${tm}-pom-${suffix}`;
    const omIri = `${tm}-om-${suffix}`;
    run(
      `INSERT DATA { GRAPH <${G}> {
  <${tm}> <${RR}predicateObjectMap> <${pomIri}> .
  <${pomIri}> <${RR}predicate> <${pred}> .
  <${pomIri}> <${RR}objectMap> <${omIri}> .
  <${omIri}> <${RR}column> "${esc(col)}" .
} }`
    );
    setNewCol('');
    setNewPred('');
  };

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal mapping-editor" style={{ width: 720, maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Mapping — {table || tm}</div>
        <div className="term-meta" style={{ marginBottom: 6 }}>
          {klass && <>class <span className="term-literal">{klass}</span></>}
        </div>

        <label className="field-label">Subject IRI template</label>
        <div className="modal-row">
          <input value={template} onChange={(e) => setTemplate(e.target.value)} style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 12 }} />
          <button className="micro" title="Apply template" onClick={applyTemplate}>apply</button>
        </div>

        {error && <div className="err-text">{error}</div>}

        <div className="panel-title" style={{ marginTop: 10 }}>Column mappings</div>
        {poms === null ? (
          <div className="tree-loading">loading…</div>
        ) : (
          <table className="result-table mapping-table">
            <thead>
              <tr><th>column</th><th>predicate</th><th>datatype</th><th /></tr>
            </thead>
            <tbody>
              {poms.map((p) => (
                <tr key={p.pom}>
                  <td className="term-literal">{p.column ?? `→ ${p.template}`}</td>
                  <td>
                    <span style={{ display: 'flex', gap: 4 }}>
                      <input
                        value={drafts[p.pom] ?? ''}
                        onChange={(e) => setDrafts((d) => ({ ...d, [p.pom]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && applyPredicate(p)}
                        style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 11.5 }}
                      />
                      {drafts[p.pom] !== p.predicate && (
                        <button className="micro" title="Apply predicate" onClick={() => applyPredicate(p)}>apply</button>
                      )}
                    </span>
                  </td>
                  <td>
                    {p.column ? (
                      <select value={p.datatype?.split('#').pop() ?? ''} onChange={(e) => applyDatatype(p, e.target.value)}>
                        {DATATYPES.map((d) => (
                          <option key={d} value={d}>{d || 'string'}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="term-meta">IRI link</span>
                    )}
                  </td>
                  <td>
                    <button className="micro danger" title="Remove mapping row" onClick={() => removePom(p)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="panel-title" style={{ marginTop: 10 }}>Add column mapping</div>
        <div className="modal-row">
          <input placeholder="column name" value={newCol} onChange={(e) => setNewCol(e.target.value)} />
          <input placeholder="predicate IRI" value={newPred} onChange={(e) => setNewPred(e.target.value)} style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 11.5 }} />
          <button disabled={!newCol.trim() || !newPred.trim()} onClick={addPom}>Add</button>
        </div>

        <div className="modal-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}
