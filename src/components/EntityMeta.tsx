// Entity lifecycle + discussion + history: state chip with role-gated
// transitions, comment thread, and the change timeline — mounted on every
// inspector view.

import { useCallback, useEffect, useState } from 'react';
import { useConnection } from '../state/connection';
import { usageFor, type UsageReport } from '../rdf/queries';
import { cmdSetDeprecated } from '../rdf/commands';

interface Lifecycle {
  state: string;
  explicit: boolean;
  transitions: { to: string; label: string; role: string }[];
}

interface Comment {
  id: string;
  by: string;
  at: string;
  text: string;
}

interface HistoryEntry {
  actor: string;
  operation: string;
  at?: string;
  time?: string;
  detail?: string;
}

export function EntityMeta({ iri }: { iri: string }) {
  const conn = useConnection();
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [lc, setLc] = useState<Lifecycle | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setError('');
    fetch(`/api/lifecycle?iri=${encodeURIComponent(iri)}`)
      .then((r) => r.json())
      .then((j) => !cancelled && setLc(j))
      .catch(() => !cancelled && setLc(null));
    fetch(`/api/comments?iri=${encodeURIComponent(iri)}`)
      .then((r) => r.json())
      .then((j) => !cancelled && setComments(Array.isArray(j) ? j : []))
      .catch(() => !cancelled && setComments([]));
    fetch(`/api/entity-history?iri=${encodeURIComponent(iri)}`)
      .then((r) => r.json())
      .then((j) => !cancelled && setHistory(Array.isArray(j) ? j : []))
      .catch(() => !cancelled && setHistory([]));
    const ep = conn.active();
    if (ep) usageFor(ep, iri).then((u) => !cancelled && setUsage(u)).catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iri, nonce]);

  const transition = async (to: string) => {
    setError('');
    const r = await fetch('/api/lifecycle/transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iri, to }),
    });
    if (!r.ok) setError((await r.json()).error ?? `${r.status}`);
    refresh();
  };

  const comment = async () => {
    if (!draft.trim()) return;
    await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iri, text: draft.trim() }),
    });
    setDraft('');
    refresh();
  };

  return (
    <div className="entity-meta">
      {usage && (
        <div className="usage-row term-meta">
          {usage.deprecated && <span className="dep-chip">deprecated</span>}
          used by {usage.incoming} triple(s)
          {usage.asPredicate > 0 && <> · predicate in {usage.asPredicate}</>}
          {usage.inShapes > 0 && <> · {usage.inShapes} shape path(s)</>}
          {usage.inMappings > 0 && <> · {usage.inMappings} mapping(s)</>}
          <button
            className="micro"
            style={{ marginLeft: 6 }}
            title={usage.deprecated ? 'Remove the deprecation flag' : 'Mark deprecated (strikethrough everywhere, warning on reuse)'}
            onClick={async () => {
              const ep = conn.active();
              if (!ep) return;
              await cmdSetDeprecated(ep, conn.activeGraph, iri, !usage.deprecated);
              refresh();
            }}
          >
            {usage.deprecated ? 'revive' : 'deprecate'}
          </button>
        </div>
      )}
      {lc && (
        <div className="lifecycle-row">
          <span className={`state-chip state-${lc.state}`} title={lc.explicit ? 'explicit state' : 'initial state (never transitioned)'}>
            {lc.state}
          </span>
          {lc.transitions.map((t) => (
            <button key={t.to} className="micro" title={`→ ${t.to} (needs ${t.role})`} onClick={() => transition(t.to)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {error && <div className="err-text">{error}</div>}

      <details className="entity-section">
        <summary className="panel-title" style={{ cursor: 'pointer' }}>
          Comments{comments && comments.length > 0 ? ` (${comments.length})` : ''}
        </summary>
        <ul className="comment-list">
          {comments?.map((c) => (
            <li key={c.id}>
              <span className="term-meta">{c.by} · {new Date(c.at).toLocaleString()}</span>
              <div>{c.text}</div>
            </li>
          ))}
          {comments?.length === 0 && <li className="term-meta">no comments yet</li>}
        </ul>
        <div className="modal-row">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && comment()}
            placeholder="Add a comment…"
            style={{ flex: 1 }}
          />
          <button className="micro" disabled={!draft.trim()} onClick={comment}>Post</button>
        </div>
      </details>

      <details className="entity-section">
        <summary className="panel-title" style={{ cursor: 'pointer' }}>History</summary>
        <ul className="history-list">
          {history?.map((h, i) => (
            <li key={i}>
              <span className="term-meta">{h.actor}</span> {h.operation}
              <span className="term-meta"> · {(h.at ?? h.time ?? '').replace('T', ' ').slice(0, 19)}</span>
            </li>
          ))}
          {history?.length === 0 && <li className="term-meta">no recorded changes mention this IRI</li>}
        </ul>
      </details>
    </div>
  );
}
