// Review workflow UI: proposals list, staged diff, and role-gated actions
// (submit as author, approve/reject as steward of the target graph or admin).

import { useCallback, useEffect, useState } from 'react';
import { useIdentity } from '../state/identity';

interface Proposal {
  id: string;
  title: string;
  author: string;
  targetGraph: string;
  status: string;
  createdAt: string;
  reviewer: string | null;
  note: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'var(--text-dim)',
  submitted: 'var(--busy)',
  merged: 'var(--ok)',
  rejected: 'var(--err)',
};

export function ProposalsPanel() {
  const identity = useIdentity();
  const me = identity.current();
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ adds: string[]; dels: string[] } | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    fetch('/api/proposals').then((r) => r.json()).then(setProposals).catch(() => setProposals([]));
  }, []);
  useEffect(refresh, [refresh]);

  useEffect(() => {
    if (!openId) {
      setDiff(null);
      return;
    }
    fetch(`/api/proposals/${openId}/diff`).then((r) => r.json()).then((d) => setDiff({ adds: d.adds ?? [], dels: d.dels ?? [] })).catch(() => setDiff(null));
  }, [openId]);

  const act = async (id: string, action: string, note?: string) => {
    setError('');
    const res = await fetch(`/api/proposals/${id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note ? { note } : {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setError(json.error ?? `${res.status}`);
    refresh();
    if (openId === id) setOpenId(null);
  };

  const canReview = (p: Proposal) => me.role === 'admin' || (me.role === 'steward' && me.governs.includes(p.targetGraph));

  if (proposals === null) return <div className="tree-loading">loading proposals…</div>;

  return (
    <div>
      {error && <div className="err-text" style={{ marginBottom: 6 }}>{error}</div>}
      {proposals.length === 0 && <div className="placeholder">No proposals yet — stage changes via the agent's propose mode or X-Studio-Proposal writes</div>}
      <ul className="issue-list">
        {proposals.map((p) => (
          <li key={p.id} className="issue" style={{ borderLeftColor: STATUS_COLOR[p.status] ?? 'var(--border)' }}>
            <div className="issue-node" onClick={() => setOpenId(openId === p.id ? null : p.id)} title={p.targetGraph}>
              {p.title}
              <span className="term-meta"> · {p.status} · by {p.author}</span>
            </div>
            {p.reviewer && <div className="issue-msg">reviewed by {p.reviewer}{p.note ? ` — ${p.note}` : ''}</div>}
            {openId === p.id && (
              <div className="proposal-detail">
                {diff && (
                  <div className="proposal-diff">
                    {diff.adds.map((t, i) => (
                      <div key={`a${i}`} className="diff-add">+ {t}</div>
                    ))}
                    {diff.dels.map((t, i) => (
                      <div key={`d${i}`} className="diff-del">− {t}</div>
                    ))}
                    {diff.adds.length === 0 && diff.dels.length === 0 && <div className="term-meta">no staged changes yet</div>}
                  </div>
                )}
                <div className="resource-actions">
                  {p.status === 'draft' && (p.author === me.name || me.role === 'admin') && (
                    <button className="ghost" onClick={() => act(p.id, 'submit')}>Submit for review</button>
                  )}
                  {['draft', 'submitted'].includes(p.status) && canReview(p) && (
                    <>
                      <button className="ghost" onClick={() => act(p.id, 'approve')}>✓ Approve & merge</button>
                      <button className="ghost danger-text" onClick={() => act(p.id, 'reject')}>✕ Reject</button>
                    </>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
