// Crosswalk review surface: map the active concept scheme to another one.
// Suggestions come from the server (label-exact + token-overlap); each is
// accepted with a chosen SKOS mapping relation or dismissed for this session.
// Existing mappings list below with remove.

import { useCallback, useEffect, useState } from 'react';
import { useIdentity } from '../state/identity';

const RELATIONS = ['exactMatch', 'closeMatch', 'broadMatch', 'narrowMatch', 'relatedMatch'];

interface Suggestion {
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  score: number;
  basis: string;
}

interface Mapping {
  from: string;
  relation: string;
  to: string;
}

export function CrosswalkDialog({
  fromScheme,
  fromLabel,
  schemes,
  onClose,
}: {
  fromScheme: string;
  fromLabel: string;
  schemes: { iri: string; label: string }[];
  onClose: () => void;
}) {
  const actingUser = useIdentity((s) => s.actingUser);
  const others = schemes.filter((s) => s.iri !== fromScheme);
  const [toScheme, setToScheme] = useState(others[0]?.iri ?? '');
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [existing, setExisting] = useState<Mapping[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [relation, setRelation] = useState('exactMatch');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!toScheme) return;
    setSuggestions(null);
    setError('');
    try {
      const r = await fetch(
        `/api/crosswalk/suggest?from=${encodeURIComponent(fromScheme)}&to=${encodeURIComponent(toScheme)}`
      );
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? `${r.status}`);
      setSuggestions(json.suggestions);
      setExisting(json.existing);
    } catch (e) {
      setError((e as Error).message);
      setSuggestions([]);
    }
  }, [fromScheme, toScheme]);

  useEffect(() => {
    load();
  }, [load]);

  const accept = async (s: Suggestion) => {
    setError('');
    try {
      const r = await fetch('/api/crosswalk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Studio-User': actingUser },
        body: JSON.stringify({ from: s.from, to: s.to, relation }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? `${r.status}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (m: Mapping) => {
    setError('');
    try {
      const r = await fetch('/api/crosswalk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-Studio-User': actingUser },
        body: JSON.stringify(m),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? `${r.status}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const visible = (suggestions ?? []).filter((s) => !dismissed.has(`${s.from}|${s.to}`));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 640, maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Crosswalk — {fromLabel}</div>

        <div className="modal-row">
          <label className="term-meta">to scheme</label>
          <select value={toScheme} onChange={(e) => setToScheme(e.target.value)} style={{ flex: 1 }}>
            {others.length === 0 && <option value="">no other schemes</option>}
            {others.map((s) => (
              <option key={s.iri} value={s.iri}>{s.label}</option>
            ))}
          </select>
          <label className="term-meta">accept as</label>
          <select value={relation} onChange={(e) => setRelation(e.target.value)}>
            {RELATIONS.map((r) => (
              <option key={r} value={r}>skos:{r}</option>
            ))}
          </select>
        </div>

        {error && <div className="err-text">{error}</div>}

        <div className="panel-title" style={{ marginTop: 10 }}>Suggestions</div>
        {suggestions === null ? (
          <div className="tree-loading">matching…</div>
        ) : visible.length === 0 ? (
          <div className="term-meta">no unmapped label matches between these schemes</div>
        ) : (
          <ul className="ext-list crosswalk-list">
            {visible.map((s) => (
              <li key={`${s.from}|${s.to}`} className="ext-row">
                <span className="ext-name">
                  {s.fromLabel} <span className="term-meta">→</span> {s.toLabel}
                </span>
                <span className="term-meta" title={s.basis}>{Math.round(s.score * 100)}%</span>
                <button className="micro" title={`Accept as skos:${relation}`} onClick={() => accept(s)}>✓</button>
                <button
                  className="micro danger"
                  title="Dismiss suggestion"
                  onClick={() => setDismissed((d) => new Set(d).add(`${s.from}|${s.to}`))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="panel-title" style={{ marginTop: 10 }}>Existing mappings</div>
        {existing.length === 0 ? (
          <div className="term-meta">none yet</div>
        ) : (
          <ul className="ext-list crosswalk-list">
            {existing.map((m) => (
              <li key={`${m.from}|${m.relation}|${m.to}`} className="ext-row">
                <span className="ext-name" title={`${m.from} → ${m.to}`}>
                  {m.from.split(/[#/]/).pop()} <span className="term-meta">skos:{m.relation}</span> {m.to.split(/[#/]/).pop()}
                </span>
                <button className="micro danger" title="Remove mapping" onClick={() => remove(m)}>✕</button>
              </li>
            ))}
          </ul>
        )}

        <div className="modal-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
