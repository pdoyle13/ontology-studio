// Live data grid for a virtual class: sortable columns, per-column LIKE
// filter, load-more paging — every interaction is a fresh guarded SQL query
// against the owning database, planned from the KG catalog.

import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import { useGraph } from '../state/graph';
import { displayName, humanize } from '../rdf/display';

interface GridState {
  classIri: string | null;
}

export const useDataGrid = create<GridState>(() => ({ classIri: null }));
export const openDataGrid = (classIri: string) => useDataGrid.setState({ classIri });

const PAGE = 50;

interface QueryResult {
  source: { id: string; kind: string };
  table: string;
  sql: string;
  rows: Record<string, unknown>[];
}

export function DataGrid() {
  const classIri = useDataGrid((s) => s.classIri);
  const selectResource = useGraph((s) => s.selectResource);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [meta, setMeta] = useState<{ source: string; kind: string; table: string; sql: string } | null>(null);
  const [sort, setSort] = useState<{ column: string; dir: 'asc' | 'desc' } | null>(null);
  const [filter, setFilter] = useState<{ column: string; text: string } | null>(null);
  const [filterDraft, setFilterDraft] = useState('');
  const [offset, setOffset] = useState(0);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const fetchPage = useCallback(
    async (nextOffset: number, append: boolean) => {
      if (!classIri) return;
      setBusy(true);
      setError('');
      try {
        const res = await fetch('/api/federate/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classIri,
            limit: PAGE,
            offset: nextOffset,
            orderBy: sort ?? undefined,
            filters: filter?.text ? [{ column: filter.column, op: 'ILIKE', value: `%${filter.text}%` }] : undefined,
          }),
        });
        const json: QueryResult & { error?: string } = await res.json();
        if (!res.ok) throw new Error(json.error ?? `${res.status}`);
        setMeta({ source: json.source.id, kind: json.source.kind, table: json.table, sql: json.sql });
        setRows((prev) => (append ? [...prev, ...json.rows] : json.rows));
        setDone(json.rows.length < PAGE);
        setOffset(nextOffset + json.rows.length);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [classIri, sort, filter]
  );

  useEffect(() => {
    setRows([]);
    setOffset(0);
    setDone(false);
    if (classIri) fetchPage(0, false);
  }, [classIri, sort, filter, fetchPage]);

  if (!classIri) return null;
  const close = () => {
    useDataGrid.setState({ classIri: null });
    setSort(null);
    setFilter(null);
    setFilterDraft('');
  };
  const columns = rows.length ? Object.keys(rows[0]).filter((c) => c !== '__iri') : [];

  const toggleSort = (column: string) => {
    setSort((s) => (s?.column === column ? (s.dir === 'asc' ? { column, dir: 'desc' } : null) : { column, dir: 'asc' }));
  };

  return (
    <div className="data-grid">
      <div className="grid-head">
        <span className="panel-title" style={{ margin: 0 }}>
          {displayName(classIri)} <span className="term-meta">live · {meta ? `${meta.source} (${meta.kind}) · ${meta.table}` : '…'}</span>
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {filter && (
            <span className="term-meta">
              {humanize(filter.column)} contains “{filter.text}”{' '}
              <button className="micro" onClick={() => setFilter(null)}>✕</button>
            </span>
          )}
          <button className="ghost" onClick={close}>Close</button>
        </span>
      </div>
      {error && <div className="err-text" style={{ padding: '4px 10px' }}>{error}</div>}
      <div className="grid-scroll">
        <table className="result-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} onClick={() => toggleSort(c)} className="sortable" title="Click to sort">
                  {humanize(c)} {sort?.column === c ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                </th>
              ))}
            </tr>
            <tr>
              {columns.map((c) => (
                <th key={`f${c}`}>
                  <input
                    className="grid-filter"
                    placeholder="filter…"
                    value={filter?.column === c ? filterDraft : ''}
                    onChange={(e) => {
                      setFilterDraft(e.target.value);
                      if (filter?.column !== c) setFilter(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setFilter(filterDraft ? { column: c, text: filterDraft } : null);
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="grid-row" onClick={() => selectResource(String(r.__iri))} title={String(r.__iri)}>
                {columns.map((c) => (
                  <td key={c} className="term-literal">{r[c] === null || r[c] === undefined ? '' : String(r[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid-foot">
        <span className="term-meta">{rows.length} rows{done ? ' (all)' : ''}</span>
        {!done && (
          <button className="ghost" disabled={busy} onClick={() => fetchPage(offset, true)}>
            {busy ? 'Loading…' : 'Load more'}
          </button>
        )}
        {meta && <span className="term-meta grid-sql" title={meta.sql}>{meta.sql}</span>}
      </div>
    </div>
  );
}
