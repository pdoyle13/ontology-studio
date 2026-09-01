import { useEffect, useState } from 'react';
import { Button, Ghost, Select } from '../ui/controls';
import { useConnection } from '../state/connection';
import { useGraph } from '../state/graph';
import { Parser } from 'n3';
import { select, ask, construct, update, type SelectResult } from '../rdf/sparqlClient';
import { useCanvas } from '../state/canvas';
import {
    listSavedQueries,
    saveQuery,
    deleteSavedQuery,
    extractParams,
    applyParams,
    type SavedQuery,
} from '../rdf/savedQueries';

type ResultView =
    | { kind: 'select'; result: SelectResult }
    | { kind: 'boolean'; value: boolean }
    | { kind: 'text'; text: string }
    | { kind: 'ok'; message: string }
    | { kind: 'sql'; columns: string[]; rows: Record<string, unknown>[]; truncated: boolean }
    | { kind: 'error'; message: string }
    | null;

const DEFAULT_QUERY = 'SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 25';
const DEFAULT_SQL = "SELECT name FROM sqlite_master WHERE type='table'";

export function SparqlDrawer() {
    const conn = useConnection();
    const { prefixes, selectResource, loadClasses, refreshSelected } = useGraph();
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<'sparql' | 'sql'>('sparql');
    const [query, setQuery] = useState(DEFAULT_QUERY);
    const [sqlText, setSqlText] = useState(DEFAULT_SQL);
    const [sqlSources, setSqlSources] = useState<{ id: string }[]>([]);
    const [sqlSource, setSqlSource] = useState('');
    const [usePrefixes, setUsePrefixes] = useState(true);
    const [running, setRunning] = useState(false);
    const [view, setView] = useState<ResultView>(null);
    const [saved, setSaved] = useState<SavedQuery[]>([]);
    const [loadedIri, setLoadedIri] = useState('');
    const [paramVals, setParamVals] = useState<Record<string, string>>({});
    const paramNames = extractParams(mode === 'sparql' ? query : sqlText);

    const refreshSaved = () => {
        const ep = conn.active();
        if (!ep) return;
        listSavedQueries(ep)
            .then(setSaved)
            .catch(() => setSaved([]));
    };
    useEffect(() => {
        if (open && conn.status === 'connected') refreshSaved();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, conn.activeId]);

    const loadSaved = (iri: string) => {
        setLoadedIri(iri);
        const q = saved.find((x) => x.iri === iri);
        if (!q) return;
        setMode(q.mode);
        setParamVals(q.params ?? {});
        if (q.mode === 'sparql') setQuery(q.text);
        else {
            setSqlText(q.text);
            if (q.sourceId) setSqlSource(q.sourceId);
        }
    };

    const doSave = async () => {
        const ep = conn.active();
        if (!ep) return;
        const existing = saved.find((x) => x.iri === loadedIri);
        const title = window.prompt('Save query as:', existing?.title ?? '');
        if (!title?.trim()) return;
        const iri = await saveQuery(ep, {
            title: title.trim(),
            mode,
            text: mode === 'sparql' ? query : sqlText,
            sourceId: mode === 'sql' ? sqlSource || null : null,
            params: Object.fromEntries(paramNames.filter((n) => paramVals[n]).map((n) => [n, paramVals[n]])),
        });
        setLoadedIri(iri);
        refreshSaved();
    };

    const doDeleteSaved = async () => {
        const ep = conn.active();
        if (!ep || !loadedIri) return;
        await deleteSavedQuery(ep, loadedIri);
        setLoadedIri('');
        refreshSaved();
    };

    useEffect(() => {
        if (mode !== 'sql') return;
        fetch('/api/sql/sources')
            .then((r) => r.json())
            .then((list: { id: string }[]) => {
                setSqlSources(list);
                if (list.length && !list.some((s) => s.id === sqlSource)) setSqlSource(list[0].id);
            })
            .catch(() => setSqlSources([]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode]);

    const runSql = async () => {
        if (!sqlSource || running) return;
        setRunning(true);
        setView(null);
        try {
            const res = await fetch(`/api/sql/sources/${sqlSource}/query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql: applyParams(sqlText, paramVals) }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error ?? `${res.status}`);
            setView({ kind: 'sql', columns: json.columns, rows: json.rows, truncated: json.truncated });
        } catch (e) {
            setView({ kind: 'error', message: (e as Error).message });
        } finally {
            setRunning(false);
        }
    };

    const run = async () => {
        const ep = conn.active();
        if (!ep || running) return;
        const bound = applyParams(query, paramVals);
        const q = usePrefixes ? `${prefixes.sparqlPreamble()}\n${bound}` : bound;
        const kw = bound
            .replace(/^\s*(PREFIX[^\n]*\n|#[^\n]*\n)*/gim, '')
            .trim()
            .slice(0, 30)
            .toUpperCase();
        // scope to the active graph; with none picked, union all graphs (Oxigraph)
        const dataset = conn.activeGraph ? { defaultGraph: conn.activeGraph } : { union: true };
        setRunning(true);
        setView(null);
        try {
            if (kw.startsWith('SELECT')) {
                setView({ kind: 'select', result: await select(ep, q, dataset) });
            } else if (kw.startsWith('ASK')) {
                setView({ kind: 'boolean', value: await ask(ep, q, dataset) });
            } else if (kw.startsWith('CONSTRUCT') || kw.startsWith('DESCRIBE')) {
                setView({ kind: 'text', text: await construct(ep, q, dataset) });
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
                    Query {open ? '▾' : '▸'}
                </span>
                {open && (
                    <span className="drawer-controls" onClick={(e) => e.stopPropagation()}>
                        <span className="tab-row" style={{ margin: 0 }}>
                            <button
                                className={`tab ${mode === 'sparql' ? 'active' : ''}`}
                                onClick={() => setMode('sparql')}
                            >
                                SPARQL
                            </button>
                            <button className={`tab ${mode === 'sql' ? 'active' : ''}`} onClick={() => setMode('sql')}>
                                SQL
                            </button>
                        </span>
                        {mode === 'sparql' ? (
                            <label className="term-meta">
                                <input
                                    type="checkbox"
                                    checked={usePrefixes}
                                    onChange={(e) => setUsePrefixes(e.target.checked)}
                                />{' '}
                                prepend prefixes
                            </label>
                        ) : (
                            <Select
                                value={sqlSource}
                                onChange={(e) => setSqlSource(e.target.value)}
                                style={{ width: 'auto' }}
                            >
                                {sqlSources.length === 0 && <option value="">no SQL sources</option>}
                                {sqlSources.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.id}
                                    </option>
                                ))}
                            </Select>
                        )}
                        <Select
                            className="saved-picker"
                            value={loadedIri}
                            onChange={(e) => loadSaved(e.target.value)}
                            title="Saved queries"
                            style={{ width: 'auto' }}
                        >
                            <option value="">saved queries…</option>
                            {saved.map((q) => (
                                <option key={q.iri} value={q.iri}>
                                    {q.title} ({q.mode})
                                </option>
                            ))}
                        </Select>
                        <Ghost onClick={doSave} title="Save the current query">
                            ⤓ Save
                        </Ghost>
                        {loadedIri && (
                            <Ghost onClick={doDeleteSaved} title="Delete this saved query">
                                ✕
                            </Ghost>
                        )}
                        <Button
                            onClick={mode === 'sparql' ? run : runSql}
                            disabled={running || (mode === 'sparql' ? conn.status !== 'connected' : !sqlSource)}
                        >
                            {running ? 'Running…' : 'Run (Ctrl+Enter)'}
                        </Button>
                    </span>
                )}
            </div>
            {open && (
                <div className="drawer-body">
                    {paramNames.length > 0 && (
                        <div className="query-params">
                            {paramNames.map((n) => (
                                <label key={n} className="term-meta">
                                    {'{{'}
                                    {n}
                                    {'}}'}{' '}
                                    <input
                                        className="param-input"
                                        value={paramVals[n] ?? ''}
                                        placeholder="value"
                                        onChange={(e) => setParamVals((v) => ({ ...v, [n]: e.target.value }))}
                                    />
                                </label>
                            ))}
                        </div>
                    )}
                    <textarea
                        className="sparql-input"
                        value={mode === 'sparql' ? query : sqlText}
                        onChange={(e) => (mode === 'sparql' ? setQuery(e.target.value) : setSqlText(e.target.value))}
                        onKeyDown={(e) => {
                            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                                e.preventDefault();
                                if (mode === 'sparql') run();
                                else runSql();
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
                                                            <a
                                                                className="term-link"
                                                                title={t.value}
                                                                onClick={() => selectResource(t.value)}
                                                            >
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
                        {view?.kind === 'select' && <div className="term-meta">{view.result.bindings.length} rows</div>}
                        {view?.kind === 'boolean' && <div className="term-literal">{String(view.value)}</div>}
                        {view?.kind === 'text' && (
                            <>
                                <button
                                    className="ghost"
                                    style={{ marginBottom: 6 }}
                                    onClick={() => {
                                        try {
                                            const quads = new Parser().parse(view.text);
                                            useCanvas.getState().addTriples(
                                                quads.map((q) => ({
                                                    s: q.subject.value,
                                                    p: q.predicate.value,
                                                    o: q.object.value,
                                                    oIsIri: q.object.termType === 'NamedNode',
                                                })),
                                            );
                                        } catch (e) {
                                            window.alert(`Parse failed: ${(e as Error).message}`);
                                        }
                                    }}
                                >
                                    Show on canvas
                                </button>
                                <pre className="turtle-out">{view.text}</pre>
                            </>
                        )}
                        {view?.kind === 'ok' && <div style={{ color: 'var(--ok)' }}>{view.message}</div>}
                        {view?.kind === 'sql' && (
                            <>
                                <table className="result-table">
                                    <thead>
                                        <tr>
                                            {view.columns.map((c) => (
                                                <th key={c}>{c}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {view.rows.map((r, i) => (
                                            <tr key={i}>
                                                {view.columns.map((c) => (
                                                    <td key={c} className="term-literal">
                                                        {r[c] === null ? '' : String(r[c])}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div className="term-meta">
                                    {view.rows.length} rows{view.truncated ? ' (truncated at 1000)' : ''}
                                </div>
                            </>
                        )}
                        {view?.kind === 'error' && <div className="err-text">{view.message}</div>}
                    </div>
                </div>
            )}
        </footer>
    );
}
