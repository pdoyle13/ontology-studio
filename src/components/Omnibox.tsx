// Omnibox: unified keyword search over the whole estate — model terms from
// the meta graph plus live rows from every attached database (label-column
// LIKE, planned per source from the KG catalog). Ctrl/Cmd+K to open.

import { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useConnection } from '../state/connection';
import { useGraph } from '../state/graph';
import { searchResources } from '../rdf/queries';
import { displayName } from '../rdf/display';

interface OmniState {
  open: boolean;
}
export const useOmnibox = create<OmniState>(() => ({ open: false }));
export const openOmnibox = () => useOmnibox.setState({ open: true });

interface Hit {
  iri: string;
  label: string | null;
  group: 'model' | 'data';
  detail?: string;
}

export function Omnibox() {
  const open = useOmnibox((s) => s.open);
  const conn = useConnection();
  const selectResource = useGraph((s) => s.selectResource);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useOmnibox.setState({ open: !useOmnibox.getState().open });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setHits([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    const ep = conn.active();
    if (!open || !ep || q.trim().length < 2) {
      setHits([]);
      return;
    }
    const text = q.trim();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const [meta, data] = await Promise.all([
          searchResources(ep, conn.activeGraph, text, 12).catch(() => []),
          fetch(`/api/virtual/search?q=${encodeURIComponent(text)}`)
            .then((r) => (r.ok ? r.json() : []))
            .catch(() => []) as Promise<{ iri: string; label: string | null; classIri: string; sourceId: string }[]>,
        ]);
        const merged: Hit[] = [
          ...meta.map((m) => ({ iri: m.iri, label: m.label, group: 'model' as const })),
          ...data.map((d) => ({
            iri: d.iri,
            label: d.label,
            group: 'data' as const,
            detail: `${displayName(d.classIri)} · ${d.sourceId}`,
          })),
        ];
        setHits(merged);
        setActive(0);
      } finally {
        setBusy(false);
      }
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open, conn.activeId, conn.activeGraph]);

  const close = useCallback(() => useOmnibox.setState({ open: false }), []);
  const pick = useCallback(
    (h: Hit) => {
      selectResource(h.iri);
      close();
    },
    [selectResource, close]
  );

  if (!open) return null;

  const groups: { key: Hit['group']; title: string; items: { hit: Hit; idx: number }[] }[] = [
    { key: 'model', title: 'Model', items: [] },
    { key: 'data', title: 'Live data', items: [] },
  ];
  hits.forEach((hit, idx) => groups.find((g) => g.key === hit.group)!.items.push({ hit, idx }));

  return (
    <div className="omnibox-backdrop" onMouseDown={close}>
      <div className="omnibox" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="omnibox-input"
          placeholder="Search classes, properties, shapes, live data…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && hits[active]) {
              pick(hits[active]);
            }
          }}
        />
        <div className="omnibox-results">
          {groups.map(
            (g) =>
              g.items.length > 0 && (
                <div key={g.key}>
                  <div className="omnibox-group">{g.title}</div>
                  {g.items.map(({ hit, idx }) => (
                    <div
                      key={hit.iri + idx}
                      className={`omnibox-hit ${idx === active ? 'active' : ''}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => pick(hit)}
                      title={hit.iri}
                    >
                      <span className="omnibox-label">{displayName(hit.iri, hit.label)}</span>
                      {hit.detail && <span className="term-meta">{hit.detail}</span>}
                    </div>
                  ))}
                </div>
              )
          )}
          {q.trim().length >= 2 && !busy && hits.length === 0 && <div className="omnibox-empty">No matches</div>}
          {q.trim().length < 2 && <div className="omnibox-empty">Type at least 2 characters — Esc to close</div>}
        </div>
      </div>
    </div>
  );
}
