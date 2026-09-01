// Omnibox: unified keyword search over the whole estate — model terms from
// the meta graph plus live rows from every attached database (label-column
// LIKE, planned per source from the KG catalog). Ctrl/Cmd+K to open.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { useConnection } from '../state/connection';
import { useGraph } from '../state/graph';
import { searchResources } from '../rdf/queries';
import { displayName } from '../rdf/display';

// SECURITY (P1.7): search highlights come from indexed content (instance data),
// so they must never be injected as HTML. The engine wraps matches in
// <em>…</em>; render those as real elements and everything else as plain text,
// which React escapes. This replaces a bypassable regex tag-stripper + innerHTML.
export function renderHighlight(s: string): ReactNode[] {
    const out: ReactNode[] = [];
    const re = /<em>([\s\S]*?)<\/em>/gi;
    let last = 0;
    let key = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
        if (m.index > last) out.push(s.slice(last, m.index));
        out.push(<em key={key++}>{m[1]}</em>);
        last = m.index + m[0].length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
}

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
    highlight?: string | null;
}

interface Facets {
    byKind?: { buckets: { key: string; doc_count: number }[] };
    bySource?: { buckets: { key: string; doc_count: number }[] };
}

export function Omnibox() {
    const open = useOmnibox((s) => s.open);
    const conn = useConnection();
    const selectResource = useGraph((s) => s.selectResource);
    const [q, setQ] = useState('');
    const [hits, setHits] = useState<Hit[]>([]);
    const [facets, setFacets] = useState<Facets>({});
    const [kindFilter, setKindFilter] = useState<string | null>(null);
    const [sourceFilter, setSourceFilter] = useState<string | null>(null);
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
                interface SearchHit {
                    iri: string;
                    label: string | null;
                    kind: 'model' | 'data';
                    type?: string;
                    classIri?: string;
                    sourceId?: string;
                }
                // one call to the search service (BM25 over model terms + live rows);
                // SPARQL fallback keeps the box working if the index is unavailable
                let hitsRaw: (SearchHit & { _highlight?: string | null })[] = [];
                try {
                    const u = new URL('/api/search', location.origin);
                    u.searchParams.set('q', text);
                    if (kindFilter) u.searchParams.set('kind', kindFilter);
                    if (sourceFilter) u.searchParams.set('sourceId', sourceFilter);
                    const r = await fetch(u);
                    if (r.ok) {
                        const json = await r.json();
                        hitsRaw = json.hits;
                        setFacets(json.facets ?? {});
                    }
                } catch {
                    /* fall through */
                }
                if (hitsRaw.length === 0) {
                    const meta = await searchResources(ep, conn.activeGraph, text, 12).catch(() => []);
                    hitsRaw = meta.map((m) => ({ iri: m.iri, label: m.label, kind: 'model' as const }));
                }
                const merged: Hit[] = hitsRaw.map((h) => ({
                    iri: h.iri,
                    label: h.label,
                    group: h.kind === 'data' ? ('data' as const) : ('model' as const),
                    detail:
                        h.kind === 'data' && h.classIri ? `${displayName(h.classIri)} · ${h.sourceId ?? ''}` : h.type,
                    highlight: h._highlight ?? null,
                }));
                setHits(merged);
                setActive(0);
            } finally {
                setBusy(false);
            }
        }, 200);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [q, open, conn.activeId, conn.activeGraph, kindFilter, sourceFilter]);

    const close = useCallback(() => useOmnibox.setState({ open: false }), []);
    const pick = useCallback(
        (h: Hit) => {
            selectResource(h.iri);
            close();
        },
        [selectResource, close],
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
                <div className="omnibox-facets">
                    <button className={`facet ${!kindFilter ? 'on' : ''}`} onClick={() => setKindFilter(null)}>
                        All
                    </button>
                    {(facets.byKind?.buckets ?? []).map((b) => (
                        <button
                            key={b.key}
                            className={`facet ${kindFilter === b.key ? 'on' : ''}`}
                            onClick={() => setKindFilter(kindFilter === b.key ? null : b.key)}
                        >
                            {b.key} ({b.doc_count})
                        </button>
                    ))}
                    {(facets.bySource?.buckets ?? []).slice(0, 5).map((b) => (
                        <button
                            key={b.key}
                            className={`facet src ${sourceFilter === b.key ? 'on' : ''}`}
                            onClick={() => setSourceFilter(sourceFilter === b.key ? null : b.key)}
                        >
                            {b.key} ({b.doc_count})
                        </button>
                    ))}
                    {q.trim().length >= 2 && (
                        <button
                            className="facet watch"
                            title="Notify me when new results appear for this search"
                            onClick={async () => {
                                await fetch('/api/search/watches', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ query: q.trim() }),
                                });
                                const { pushToast } = await import('../state/collab');
                                pushToast(`Watching “${q.trim()}” — you’ll be notified on new results`);
                            }}
                        >
                            👁 watch
                        </button>
                    )}
                </div>
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
                                            {hit.highlight && (
                                                <span className="omnibox-snippet">
                                                    {renderHighlight(hit.highlight)}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ),
                    )}
                    {q.trim().length >= 2 && !busy && hits.length === 0 && (
                        <div className="omnibox-empty">No matches</div>
                    )}
                    {q.trim().length < 2 && (
                        <div className="omnibox-empty">Type at least 2 characters — Esc to close</div>
                    )}
                </div>
            </div>
        </div>
    );
}
