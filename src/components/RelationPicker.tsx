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

export function RelationPicker({
  at,
  sourceLabel,
  targetLabel,
  onPick,
  onCancel,
}: {
  at: { x: number; y: number };
  sourceLabel: string;
  targetLabel: string;
  onPick: (predicateIri: string) => void;
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

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return props.slice(0, 8);
    return props.filter((p) => p.label.toLowerCase().includes(q) || p.iri.toLowerCase().includes(q)).slice(0, 8);
  }, [props, text]);

  const confirm = (iri?: string) => {
    const value = iri ?? (filtered[highlight]?.iri || (text.trim() ? prefixes.expand(text.trim()) : ''));
    if (!value) return;
    onPick(value);
  };

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
