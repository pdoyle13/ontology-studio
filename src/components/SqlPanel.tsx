// SQL datasources: attach SQLite files, inspect schema, translate schema to
// RDF ontology + SHACL shapes, materialize rows into the active graph.

import { useCallback, useEffect, useState } from 'react';
import { useConnection } from '../state/connection';
import { useGraph } from '../state/graph';

interface SourceInfo { id: string; kind: string; target: string; tables: number }
interface ColumnInfo { name: string; type: string; notnull: boolean; pk: boolean }
interface TableInfo { name: string; rowCount: number; columns: ColumnInfo[]; fks: { from: string; table: string; to: string }[] }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `${res.status}`);
  return json as T;
}

function TableRow({ source, table, ns }: { source: string; table: TableInfo; ns: string }) {
  const conn = useConnection();
  const { loadClasses } = useGraph();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  return (
    <li className="sql-table">
      <div className="class-row" onClick={() => setOpen(!open)}>
        <span className="twisty">{open ? '▾' : '▸'}</span>
        <span className="class-name">{table.name}</span>
        <span className="count">{table.rowCount.toLocaleString()}</span>
      </div>
      {msg && <div className="term-meta" style={{ marginLeft: 18 }}>{msg}</div>}
      {open && (
        <ul className="instance-list">
          {table.columns.map((c) => {
            const fk = table.fks.find((f) => f.from === c.name);
            return (
              <li key={c.name} style={{ cursor: 'default' }}>
                {c.pk ? '🔑 ' : ''}{c.name}
                <span className="term-meta"> {c.type.toLowerCase()}{c.notnull ? ' NOT NULL' : ''}{fk ? ` → ${fk.table}.${fk.to}` : ''}</span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function SourceView({ source, onRemove }: { source: SourceInfo; onRemove: () => void }) {
  const conn = useConnection();
  const { loadClasses } = useGraph();
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const ns = `https://studio.local/sql/${source.id}#`;

  useEffect(() => {
    if (!open || tables) return;
    api<{ tables: TableInfo[] }>(`/api/sql/sources/${source.id}/schema`).then((r) => setTables(r.tables)).catch((e) => setMsg(e.message));
  }, [open, tables, source.id]);

  const translate = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await api<{ tables: number; triples: number }>(`/api/sql/sources/${source.id}/translate`, {
        method: 'POST',
        body: JSON.stringify({ graph: conn.activeGraph, namespace: ns }),
      });
      setMsg(`schema → ${r.triples.toLocaleString()} triples (${r.tables} tables) as classes + SHACL shapes`);
      await conn.refreshGraphs();
      await loadClasses();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sql-source">
      <div className="class-row" onClick={() => setOpen(!open)}>
        <span className="twisty">{open ? '▾' : '▸'}</span>
        <span className="class-name" title={`${source.kind}: ${source.target}`}>{source.id}</span>
        <span className="count">{source.kind === 'postgres' ? 'pg' : 'db'} · {source.tables}t</span>
        <button className="micro danger" title="Detach" onClick={(e) => { e.stopPropagation(); onRemove(); }}>✕</button>
      </div>
      {open && (
        <div style={{ marginLeft: 6 }}>
          <div className="value-row" style={{ margin: '4px 0' }}>
            <button disabled={busy} onClick={translate} title="Generate classes + SHACL shapes from the SQL schema">
              {busy ? 'Working…' : 'Translate schema → RDF'}
            </button>
          </div>
          {msg && <div className="term-meta">{msg}</div>}
          <ul className="class-list">
            {tables?.map((t) => <TableRow key={t.name} source={source.id} table={t} ns={ns} />)}
            {!tables && <li className="tree-loading">loading schema…</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export function SqlPanel() {
  const [sourcesList, setSourcesList] = useState<SourceInfo[] | null>(null);
  const [kind, setKind] = useState('sqlite');
  const [kinds, setKinds] = useState<{ kind: string; label: string; targetKind: string; experimental?: boolean }[]>([
    { kind: 'sqlite', label: 'SQLite file', targetKind: 'file' },
  ]);
  useEffect(() => {
    fetch('/api/sql/kinds').then((r) => r.json()).then(setKinds).catch(() => {});
  }, []);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    api<SourceInfo[]>('/api/sql/sources').then(setSourcesList).catch((e) => setError(e.message));
  }, []);

  useEffect(refresh, [refresh]);

  const add = async () => {
    if (!target.trim() || busy) return;
    setError('');
    setBusy(true);
    try {
      await api('/api/sql/sources', { method: 'POST', body: JSON.stringify({ kind, target: target.trim() }) });
      setTarget('');
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="value-row" style={{ marginBottom: 8 }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {kinds.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
              {k.experimental ? ' (experimental)' : ''}
            </option>
          ))}
        </select>
        <input
          placeholder={kind === 'sqlite' ? 'path to .db / .sqlite file' : 'postgres://user:pass@host:5432/dbname'}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          style={{ flex: 1 }}
        />
        <button onClick={add} disabled={!target.trim() || busy}>{busy ? '…' : 'Attach'}</button>
      </div>
      {error && <div className="err-text">{error}</div>}
      {sourcesList === null && !error && <div className="tree-loading">connecting to studio-server…</div>}
      {sourcesList?.map((s) => (
        <SourceView
          key={s.id}
          source={s}
          onRemove={() => api(`/api/sql/sources/${s.id}`, { method: 'DELETE' }).then(refresh)}
        />
      ))}
      {sourcesList?.length === 0 && <div className="placeholder">Attach a SQLite file to begin</div>}
    </div>
  );
}
