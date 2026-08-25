// SHACL-AF rules tab: list rules with derivation counts, toggle activation,
// author new triple/SPARQL rules on a target class, and materialize the
// inferred graph on demand. Explanations live on the rule rows (counts) and
// via /api/rules/explain for any derived triple.

import { useCallback, useEffect, useState } from 'react';
import { SH } from '../rdf/vocab';
import { useConnection } from '../state/connection';
import { useGraph } from '../state/graph';
import { update } from '../rdf/sparqlClient';
import { useHistory } from '../state/history';
import { displayName } from '../rdf/display';
import { ResourcePicker } from './ResourcePicker';

const RULES_GRAPH = 'https://studio.local/graphs/rules';

interface RuleRow {
  ruleIri: string;
  shapeIri: string;
  targetClass: string | null;
  kind: 'triple' | 'sparql';
  construct: string | null;
  predicate: string | null;
  object: { value: string; isIri: boolean } | null;
  deactivated: boolean;
}

interface MatResult {
  rules: number;
  derived: number;
  passes: number;
  perRule: Record<string, number>;
}

export function RulesPanel() {
  const conn = useConnection();
  const { classes, selectResource } = useGraph();
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const [last, setLast] = useState<MatResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // new-rule form
  const [target, setTarget] = useState('');
  const [kind, setKind] = useState<'triple' | 'sparql'>('triple');
  const [predicate, setPredicate] = useState('');
  const [objectVal, setObjectVal] = useState('');
  const [objectIsIri, setObjectIsIri] = useState(false);
  const [constructText, setConstructText] = useState(
    'CONSTRUCT { $this <https://studio.local/vocab/flag> true }\nWHERE { $this ?p ?o }'
  );
  const [pickingObj, setPickingObj] = useState(false);

  useEffect(() => {
    fetch('/api/rules').then((r) => r.json()).then(setRules).catch(() => setRules([]));
  }, [nonce]);

  const materialize = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/rules/materialize', { method: 'POST' });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? `${r.status}`);
      setLast(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addRule = async () => {
    const ep = conn.active();
    if (!ep || !target) return;
    setError('');
    const slugify = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const shapeIri = `https://studio.local/shapes/rules/${slugify(displayName(target))}`;
    const ruleIri = `${shapeIri}/rule-${Date.now().toString(36)}`;
    const lit = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    const t = [
      `<${shapeIri}> a <${SH.NodeShape}> .`,
      `<${shapeIri}> <${SH.targetClass}> <${target}> .`,
      `<${shapeIri}> <${SH.rule}> <${ruleIri}> .`,
    ];
    if (kind === 'triple') {
      if (!predicate.trim() || !objectVal.trim()) {
        setError('predicate and object are required');
        return;
      }
      t.push(`<${ruleIri}> a <${SH.TripleRule}> .`);
      t.push(`<${ruleIri}> <${SH.subject}> <${SH.this}> .`);
      t.push(`<${ruleIri}> <${SH.predicate}> <${predicate.trim()}> .`);
      t.push(`<${ruleIri}> <${SH.object}> ${objectIsIri ? `<${objectVal.trim()}>` : lit(objectVal.trim())} .`);
    } else {
      t.push(`<${ruleIri}> a <${SH.SPARQLRule}> .`);
      t.push(`<${ruleIri}> <${SH.construct}> ${lit(constructText)} .`);
    }
    const block = t.join('\n');
    try {
      await useHistory.getState().exec({
        label: 'create rule',
        redo: () => update(ep, `INSERT DATA { GRAPH <${RULES_GRAPH}> { ${block} } }`),
        undo: () => update(ep, `DELETE DATA { GRAPH <${RULES_GRAPH}> { ${block} } }`),
      });
      setAdding(false);
      setPredicate('');
      setObjectVal('');
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggle = async (rule: RuleRow) => {
    const ep = conn.active();
    if (!ep) return;
    const triple = `<${rule.ruleIri}> <${SH.deactivated}> true .`;
    const q = rule.deactivated
      ? `DELETE WHERE { GRAPH ?g { <${rule.ruleIri}> <${SH.deactivated}> ?v } }`
      : `INSERT DATA { GRAPH <${RULES_GRAPH}> { ${triple} } }`;
    await update(ep, q);
    refresh();
  };

  if (conn.status !== 'connected') return <div className="placeholder">Connect to an endpoint to browse</div>;

  return (
    <div className="rules-panel">
      <div className="modal-row" style={{ marginBottom: 6 }}>
        <button onClick={materialize} disabled={busy} title="Run all active rules into the inferred graph">
          {busy ? 'Materializing…' : '⚡ Materialize'}
        </button>
        <button className="ghost" onClick={() => setAdding((a) => !a)}>＋ Rule</button>
      </div>
      {last && (
        <div className="term-meta" style={{ marginBottom: 6 }}>
          {last.derived} triples derived by {last.rules} rule(s) in {last.passes} pass(es)
        </div>
      )}
      {error && <div className="err-text">{error}</div>}
      {adding && (
        <div className="ext-form" style={{ marginBottom: 8 }}>
          <label className="field-label">Target class *</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: '100%' }}>
            <option value="">pick a class…</option>
            {classes.map((c) => (
              <option key={c.iri} value={c.iri}>{displayName(c.iri, c.label)}</option>
            ))}
          </select>
          <label className="field-label">Rule kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'triple' | 'sparql')} style={{ width: '100%' }}>
            <option value="triple">Triple rule — every member gets one triple</option>
            <option value="sparql">SPARQL rule — CONSTRUCT with $this</option>
          </select>
          {kind === 'triple' ? (
            <>
              <label className="field-label">Predicate IRI *</label>
              <input value={predicate} onChange={(e) => setPredicate(e.target.value)} placeholder="https://studio.local/vocab/asset-kind" style={{ width: '100%' }} />
              <label className="field-label">
                Object * <label className="term-meta"><input type="checkbox" checked={objectIsIri} onChange={(e) => setObjectIsIri(e.target.checked)} /> IRI</label>
              </label>
              {objectIsIri && pickingObj ? (
                <ResourcePicker classIri={null} onPick={(iri) => { setObjectVal(iri); setPickingObj(false); }} onCancel={() => setPickingObj(false)} />
              ) : (
                <div className="modal-row">
                  <input value={objectVal} onChange={(e) => setObjectVal(e.target.value)} placeholder={objectIsIri ? 'https://…' : 'literal value'} style={{ flex: 1 }} />
                  {objectIsIri && <button className="micro" onClick={() => setPickingObj(true)}>pick…</button>}
                </div>
              )}
            </>
          ) : (
            <>
              <label className="field-label">CONSTRUCT ($this = each member)</label>
              <textarea className="field-textarea" rows={4} value={constructText} onChange={(e) => setConstructText(e.target.value)} />
            </>
          )}
          <div className="modal-row" style={{ justifyContent: 'flex-end' }}>
            <button onClick={() => setAdding(false)}>Cancel</button>
            <button disabled={!target} onClick={addRule}>Create rule</button>
          </div>
        </div>
      )}
      {!rules ? (
        <div className="tree-loading">loading rules…</div>
      ) : rules.length === 0 ? (
        <div className="term-meta">No rules yet — add one to derive facts from the model.</div>
      ) : (
        <ul className="ext-list">
          {rules.map((r) => (
            <li key={r.ruleIri} className={`ext-row ${r.deactivated ? 'rule-off' : ''}`}>
              <span className="ext-name" title={r.ruleIri}>
                <a className="term-link" onClick={() => r.targetClass && selectResource(r.targetClass)}>
                  {r.targetClass
                    ? displayName(r.targetClass, classes.find((c) => c.iri === r.targetClass)?.label)
                    : '(untargeted)'}
                </a>{' '}
                {r.kind === 'triple' ? (
                  <>→ {displayName(r.predicate ?? '')} = {r.object?.isIri ? displayName(r.object.value) : r.object?.value}</>
                ) : (
                  <>→ SPARQL rule</>
                )}
              </span>
              <span className="term-meta">
                {last?.perRule[r.ruleIri] !== undefined ? `${last.perRule[r.ruleIri]} derived` : ''}
                {r.deactivated ? ' · off' : ''}
              </span>
              <button className="micro" title={r.deactivated ? 'Activate' : 'Deactivate'} onClick={() => toggle(r)}>
                {r.deactivated ? '▶' : '⏸'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="term-meta" style={{ marginTop: 8 }}>
        Derived triples land in the inferred graph and appear everywhere (tree, canvas, search) via union scope.
      </div>
    </div>
  );
}
