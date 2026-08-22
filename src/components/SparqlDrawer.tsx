import { useState } from 'react';
import { useConnection } from '../state/connection';
import { useGraph } from '../state/graph';
import { select, ask, construct, update, type SelectResult } from '../rdf/sparqlClient';

type ResultView =
  | { kind: 'select'; result: SelectResult }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string }
  | null;

const DEFAULT_QUERY = 'SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 25';

export function SparqlDrawer() {
  const conn = useConnection();
  const { prefixes, selectResource, loadClasses, refreshSelected } = useGraph();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [usePrefixes, setUsePrefixes] = useState(true);
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<ResultView>(null);

  const run = async () => {
    const ep = conn.active();
    if (!ep || running) return;
    const q = usePrefixes ? `${prefixes.sparqlPreamble()}\n${query}` : query;
    const kw = query.replace(/^\s*(PREFIX[^\n]*\n|#[^\n]*\n)*/gim, '').trim().slice(0, 30).toUpperCase();
    setRunning(true);
    setView(null);
    try {
      if (kw.startsWith('SELECT')) {
        setView({ kind: 'select', result: await select(ep, q) });
      } else if (kw.startsWith('ASK')) {
        setView({ kind: 'boolean', value: await ask(ep, q) });
      } else if (kw.startsWith('CONSTRUCT') || kw.startsWith('DESCRIBE')) {
        setView({ kind: 'text', text: await construct(ep, q) });
      } else {
        await update(ep, q);
        setView({ kind: 'ok', message: 'Update executed.' });
        await Promise.all([conn.refreshGraphs(), loadClasses(), refreshSelected()]);
      }
    } catch (e) {
      setView({ kind: 'error', message: (e as Error).message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <footer className={`sparql-drawer ${open ? 'open' : ''}`}>
      <div className="drawer-head" onClick={() => setOpen(!open)}>
        <span className="panel-title" style={{ margin: 0 }}>
          SPARQL {open ? '▾' : '▸'}
        </span>
        {open && (
          <span className="drawer-controls" onClick={(e) => e.stopPropagation()}>
            <label className="term-meta">
              <input type="checkbox" checked={usePrefixes} onChange={(e) => setUsePrefixes(e.target.checked)} />{' '}
              prepend prefixes
            </label>
            <button onClick={run} disabled={running || conn.status !== 'connected'}>
              {running ? 'Running…' : 'Run (Ctrl+Enter)'}
            </button>
          </span>
        )}
      </div>
      {open && (
        <div className="drawer-body">
          <textarea
            className="sparql-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                run();
              }
            }}
            spellCheck={false}
          />
          <div className="sparql-results">
            {view?.kind === 'select' && (
              <table className="result-table">
                <thead>
                  <tr>
                    {view.result.vars.map((v) => (
                      <th key={v}>?{v}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.result.bindings.map((b, i) => (
                    <tr key={i}>
                      {view.result.vars.map((v) => {
                        const t = b[v];
                        if (!t) return <td key={v} />;
                        if (t.type === 'uri')
                          return (
                            <td key={v}>
                              <a className="term-link" title={t.value} onClick={() => selectResource(t.value)}>
                                {prefixes.shrink(t.value)}
                              </a>
                            </td>
                          );
                        return (
                          <td key={v} className="term-literal">
                            {t.value}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {view?.kind === 'select' && (
              <div className="term-meta">{view.result.bindings.length} rows</div>
            )}
            {view?.kind === 'boolean' && <div className="term-literal">{String(view.value)}</div>}
            {view?.kind === 'text' && <pre className="turtle-out">{view.text}</pre>}
            {view?.kind === 'ok' && <div style={{ color: 'var(--ok)' }}>{view.message}</div>}
            {view?.kind === 'error' && <div className="err-text">{view.message}</div>}
          </div>
        </div>
      )}
    </footer>
  );
}
