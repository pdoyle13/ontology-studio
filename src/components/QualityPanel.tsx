// Data quality for the Govern workspace: current check counts, run-now, and
// per-check trend sparklines from persisted snapshots.

import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/controls';
import { useIdentity } from '../state/identity';

interface Check {
  id: string;
  label: string;
  count: number;
}

interface Run {
  at: string;
  checks: Record<string, number>;
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const w = 64;
  const h = 18;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${i * step},${h - (v / max) * (h - 2) - 1}`).join(' ');
  return (
    <svg width={w} height={h} className="spark">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
    </svg>
  );
}

export function QualityPanel() {
  const role = useIdentity((s) => s.current().role);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    fetch('/api/quality')
      .then((r) => r.json())
      .then((j) => {
        setChecks(j.checks ?? []);
        setHistory(j.history ?? []);
      })
      .catch(() => setChecks([]));
  }, [nonce]);

  const runNow = async () => {
    setBusy(true);
    try {
      await fetch('/api/quality/run', { method: 'POST' });
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const trend = (id: string) => [...history].reverse().map((r) => r.checks[id] ?? 0);

  return (
    <div className="quality-panel">
      <Button onClick={runNow} disabled={busy || !['steward', 'admin'].includes(role)} title="Run all checks and record a snapshot">
        {busy ? 'Running…' : '▷ Run quality checks'}
      </Button>
      {history.length > 0 && (
        <div className="term-meta" style={{ margin: '4px 0' }}>
          {history.length} recorded run(s) · latest {history[0].at.replace('T', ' ').slice(0, 16)}
        </div>
      )}
      {!checks ? (
        <div className="tree-loading">loading…</div>
      ) : (
        <ul className="quality-list">
          {checks.map((c) => (
            <li key={c.id} className={c.count > 0 ? 'q-warn' : 'q-ok'}>
              <span className="q-count">{c.count < 0 ? '?' : c.count}</span>
              <span className="q-label">{c.label}</span>
              <Spark values={trend(c.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
