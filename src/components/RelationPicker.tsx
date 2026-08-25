// Inline predicate picker for drag-to-create relations: appears at the drop
// point, suggests existing object properties (recently used first), accepts a
// freeform curie/IRI, Enter confirms, Escape cancels.

import { useEffect, useMemo, useState } from 'react';
import { useConnection } from '../state/connection';
import { useGraph } from '../state/graph';
import { select } from '../rdf/sparqlClient';
import { scoped } from '../rdf/queries';
import { humanize } from '../rdf/display';
import { localName } from '../rdf/prefixes';

const RECENT_KEY = 'studio.recentPredicates';

const getRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
};

export const rememberPredicate = (iri: string) => {
  const list = [iri, ...getRecent().filter((x) => x !== iri)].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
};

/** Namespace of an IRI: everything up to and including the last # or /. */
const namespaceOf = (iri: string): string => {
  const hash = iri.lastIndexOf('#');
  if (hash >= 0) return iri.slice(0, hash + 1);
  return iri.slice(0, iri.lastIndexOf('/') + 1);
};

/** "wrote poems for" → "wrotePoemsFor" */
const camelSlug = (text: string): string => {
  const words = text.trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return '';
  return words
    .map((w, i) => (i === 0 ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1)))
    .join('');
};

const isAbsoluteIri = (v: string) => /^[a-z][a-z0-9+.-]*:/i.test(v) && (v.includes('://') || /^(urn|mailto|tag|did):/i.test(v));

/** A virtual SQL class IRI: https://studio.local/sql/<db>#<table> (no row path). */
export const isSqlClass = (iri: string) => /^https:\/\/studio\.local\/sql\/[^#]+#[^/]+$/.test(iri);

export interface JoinSpec {
  predicate: string;
  label: string;
  sourceKey: string;
  targetKey: string;
}

export function RelationPicker({
  at,
  sourceIri,
  targetIri,
  sourceLabel,
  targetLabel,
  onPick,
  onPickJoin,
  onCancel,
}: {
  at: { x: number; y: number };
  sourceIri: string;
  targetIri?: string;
  sourceLabel: string;
  targetLabel: string;
  onPick: (predicateIri: string, mintedLabel?: string) => void;
  onPickJoin?: (spec: JoinSpec) => void;
  onCancel: () => void;
}) {
  const conn = useConnection();
  const { prefixes } = useGraph();
  const [text, setText] = useState('');
  const [props, setProps] = useState<{ iri: string; label: string }[]>([]);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    const ep = conn.active();
    if (!ep) return;
    let cancelled = false;
    // object properties in scope: anything with an IRI (non-xsd) range, or used as a link
    select(
      ep,
      `SELECT DISTINCT ?p (SAMPLE(?l) AS ?lbl) WHERE {
  ${scoped(
    `?p <http://www.w3.org/2000/01/rdf-schema#range> ?r .
     FILTER(isIRI(?r) && !STRSTARTS(STR(?r), "http://www.w3.org/2001/XMLSchema#"))
     OPTIONAL { ?p <http://www.w3.org/2000/01/rdf-schema#label> ?l }`,
    conn.activeGraph
  )}
} GROUP BY ?p LIMIT 60`
    )
      .then((r) => {
        if (cancelled) return;
        const found = r.bindings.map((b) => ({ iri: b.p.value, label: b.lbl?.value ?? humanize(localName(b.p.value)) }));
        const recent = getRecent();
        found.sort((a, b) => {
          const ra = recent.indexOf(a.iri);
          const rb = recent.indexOf(b.iri);
          return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb) || a.label.localeCompare(b.label);
        });
        setProps(found);
      })
      .catch(() => setProps([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.activeId, conn.activeGraph]);

  // two SQL classes = a field-level cross-database link: pick the join keys
  const joinMode = !!(onPickJoin && targetIri && isSqlClass(sourceIri) && isSqlClass(targetIri));
  const [srcCols, setSrcCols] = useState<{ iri: string; label: string }[]>([]);
  const [tgtCols, setTgtCols] = useState<{ iri: string; label: string }[]>([]);
  const [srcKey, setSrcKey] = useState('');
  const [tgtKey, setTgtKey] = useState('');
  const [joinName, setJoinName] = useState('');

  useEffect(() => {
    if (!joinMode) return;
    const ep = conn.active();
    if (!ep) return;
    let cancelled = false;
    const colsOf = (cls: string) =>
      select(
        ep,
        `SELECT DISTINCT ?p (SAMPLE(?l) AS ?lbl) WHERE {
  ${scoped(`?p <http://www.w3.org/2000/01/rdf-schema#domain> <${cls}> . OPTIONAL { ?p <http://www.w3.org/2000/01/rdf-schema#label> ?l }`, null)}
} GROUP BY ?p ORDER BY ?p LIMIT 200`
      ).then((r) => r.bindings.map((b) => ({ iri: b.p.value, label: b.lbl?.value ?? humanize(localName(b.p.value)) })));
    Promise.all([colsOf(sourceIri), colsOf(targetIri!)]).then(([a, b]) => {
      if (cancelled) return;
      setSrcCols(a);
      setTgtCols(b);
      // preselect likely keys: matching local-name suffixes (order_ref = order_number style is manual)
      const guess = a.find((c) => b.some((d) => localName(d.iri) === localName(c.iri)));
      if (guess) {
        setSrcKey(guess.iri);
        setTgtKey(b.find((d) => localName(d.iri) === localName(guess.iri))!.iri);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinMode, sourceIri, targetIri]);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return props.slice(0, 8);
    return props.filter((p) => p.label.toLowerCase().includes(q) || p.iri.toLowerCase().includes(q)).slice(0, 8);
  }, [props, text]);

  const confirm = (iri?: string) => {
    if (iri) return onPick(iri);
    if (filtered[highlight]) return onPick(filtered[highlight].iri);
    const raw = text.trim();
    if (!raw) return;
    const expanded = prefixes.expand(raw);
    if (isAbsoluteIri(expanded)) return onPick(expanded);
    // plain name: mint a property in the source's namespace instead of
    // sending a relative IRI the store would reject
    const slug = camelSlug(raw);
    if (!slug) return;
    onPick(namespaceOf(sourceIri) + slug, raw);
  };

  if (joinMode) {
    const ready = srcKey && tgtKey && joinName.trim();
    return (
      <div className="relation-picker" style={{ left: at.x, top: at.y }}>
        <div className="term-meta" style={{ marginBottom: 4 }}>
          Link {sourceLabel} → {targetLabel} <span title="Cross-database join: resolved live, no instance edges written">ⓘ</span>
        </div>
        <input
          autoFocus
          placeholder="relation name (e.g. has orders)"
          value={joinName}
          onChange={(e) => setJoinName(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        />
        <label className="field-label">where {sourceLabel}’s…</label>
        <select value={srcKey} onChange={(e) => setSrcKey(e.target.value)}>
          <option value="">pick key field…</option>
          {srcCols.map((c) => (
            <option key={c.iri} value={c.iri}>{c.label}</option>
          ))}
        </select>
        <label className="field-label">…matches {targetLabel}’s</label>
        <select value={tgtKey} onChange={(e) => setTgtKey(e.target.value)}>
          <option value="">pick key field…</option>
          {tgtCols.map((c) => (
            <option key={c.iri} value={c.iri}>{c.label}</option>
          ))}
        </select>
        <div className="modal-row" style={{ marginTop: 6 }}>
          <button
            disabled={!ready}
            onClick={() =>
              onPickJoin!({
                predicate: namespaceOf(sourceIri) + camelSlug(joinName),
                label: joinName.trim(),
                sourceKey: srcKey,
                targetKey: tgtKey,
              })
            }
          >
            Create link
          </button>
          <button className="ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="relation-picker" style={{ left: at.x, top: at.y }}>
      <div className="term-meta" style={{ marginBottom: 4 }}>
        {sourceLabel} → {targetLabel}
      </div>
      <input
        autoFocus
        placeholder="relation (pick, or type curie/IRI)"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setHighlight(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'ArrowDown') setHighlight((h) => Math.min(h + 1, filtered.length - 1));
          if (e.key === 'ArrowUp') setHighlight((h) => Math.max(h - 1, 0));
          if (e.key === 'Enter') confirm();
        }}
      />
      <ul className="picker-list">
        {filtered.map((p, i) => (
          <li
            key={p.iri}
            className={i === highlight ? 'active' : ''}
            title={p.iri}
            onMouseEnter={() => setHighlight(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              confirm(p.iri);
            }}
          >
            {p.label} <span className="term-meta">{prefixes.shrink(p.iri)}</span>
          </li>
        ))}
        {filtered.length === 0 && <li className="term-meta">no matches — Enter creates “{text.trim()}”</li>}
      </ul>
    </div>
  );
}
