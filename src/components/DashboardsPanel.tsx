// Dashboards: sidebar list + full-canvas page view with a widget wizard.
// Widgets execute their saved query live on every open — nothing is cached
// beyond the standard tiers, nothing is copied.

import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import { useConnection } from '../state/connection';
import {
    listDashboards,
    fetchDashboard,
    cmdCreateDashboard,
    cmdAddWidget,
    cmdRemoveWidget,
    runWidgetQuery,
    type DashboardDef,
    type WidgetDef,
    type WidgetComponent,
} from '../rdf/dashboards';
import { listSavedQueries, type SavedQuery } from '../rdf/savedQueries';
import { BarChart, LineChart, PieChart, Kpi, toSeries } from './charts';

interface DashState {
    openPage: string | null;
}
export const useDashboards = create<DashState>(() => ({ openPage: null }));
export const openDashboard = (iri: string) => useDashboards.setState({ openPage: iri });

function Widget({ w, saved, onRemove }: { w: WidgetDef; saved: SavedQuery[]; onRemove: () => void }) {
    const conn = useConnection();
    const [data, setData] = useState<{ columns: string[]; rows: Record<string, unknown>[] } | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        const ep = conn.active();
        if (!ep) return;
        let cancelled = false;
        runWidgetQuery(ep, w.queryIri, saved)
            .then((d) => !cancelled && setData(d))
            .catch((e) => !cancelled && setError((e as Error).message));
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [w.iri, w.queryIri]);

    const x = w.xField ?? data?.columns[0] ?? '';
    const y = w.yField ?? data?.columns[1] ?? '';

    return (
        <div className="widget">
            <div className="widget-head">
                <span className="panel-title" style={{ margin: 0 }}>
                    {w.label}
                </span>
                <button className="micro danger" title="Remove widget" onClick={onRemove}>
                    ✕
                </button>
            </div>
            {error && <div className="err-text">{error}</div>}
            {!data && !error && <div className="tree-loading">running…</div>}
            {data && w.component === 'kpi' && <Kpi rows={data.rows} yField={w.yField} label={w.label} />}
            {data && w.component === 'bar' && <BarChart data={toSeries(data.rows, x, y)} />}
            {data && w.component === 'line' && <LineChart data={toSeries(data.rows, x, y)} />}
            {data && w.component === 'pie' && <PieChart data={toSeries(data.rows, x, y)} />}
            {data && w.component === 'table' && (
                <div className="grid-scroll" style={{ maxHeight: 240 }}>
                    <table className="result-table">
                        <thead>
                            <tr>
                                {data.columns.map((c) => (
                                    <th key={c}>{c}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {data.rows.slice(0, 50).map((r, i) => (
                                <tr key={i}>
                                    {data.columns.map((c) => (
                                        <td key={c} className="term-literal">
                                            {String(r[c] ?? '')}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function WidgetWizard({ dash, saved, onDone }: { dash: DashboardDef; saved: SavedQuery[]; onDone: () => void }) {
    const conn = useConnection();
    const [label, setLabel] = useState('');
    const [queryIri, setQueryIri] = useState('');
    const [component, setComponent] = useState<WidgetComponent>('bar');
    const [columns, setColumns] = useState<string[]>([]);
    const [xField, setXField] = useState('');
    const [yField, setYField] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        const ep = conn.active();
        if (!ep || !queryIri) {
            setColumns([]);
            return;
        }
        runWidgetQuery(ep, queryIri, saved)
            .then((d) => {
                setColumns(d.columns);
                setXField((x) => x || d.columns[0] || '');
                setYField((y) => y || d.columns[1] || d.columns[0] || '');
            })
            .catch((e) => setError((e as Error).message));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queryIri]);

    const add = async () => {
        const ep = conn.active();
        if (!ep || !label.trim() || !queryIri) return;
        try {
            await cmdAddWidget(ep, dash.iri, {
                label: label.trim(),
                component,
                queryIri,
                xField: component === 'kpi' ? null : xField,
                yField,
                position: dash.widgets.length,
            });
            onDone();
        } catch (e) {
            setError((e as Error).message);
        }
    };

    return (
        <div className="ext-form widget-wizard">
            <label className="field-label">Widget title *</label>
            <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: '100%' }} />
            <label className="field-label">Saved query *</label>
            <select value={queryIri} onChange={(e) => setQueryIri(e.target.value)} style={{ width: '100%' }}>
                <option value="">pick…</option>
                {saved.map((q) => (
                    <option key={q.iri} value={q.iri}>
                        {q.title} ({q.mode})
                    </option>
                ))}
            </select>
            <label className="field-label">Component</label>
            <select
                value={component}
                onChange={(e) => setComponent(e.target.value as WidgetComponent)}
                style={{ width: '100%' }}
            >
                <option value="bar">bar chart</option>
                <option value="line">line chart</option>
                <option value="pie">pie chart</option>
                <option value="kpi">KPI number</option>
                <option value="table">table</option>
            </select>
            {columns.length > 0 && component !== 'table' && (
                <div className="modal-row">
                    {component !== 'kpi' && (
                        <label className="field-label" style={{ flex: 1 }}>
                            X field
                            <select
                                value={xField}
                                onChange={(e) => setXField(e.target.value)}
                                style={{ width: '100%' }}
                            >
                                {columns.map((c) => (
                                    <option key={c} value={c}>
                                        {c}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                    <label className="field-label" style={{ flex: 1 }}>
                        {component === 'kpi' ? 'Value field' : 'Y field'}
                        <select value={yField} onChange={(e) => setYField(e.target.value)} style={{ width: '100%' }}>
                            {columns.map((c) => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            )}
            {error && <div className="err-text">{error}</div>}
            <div className="modal-row" style={{ justifyContent: 'flex-end' }}>
                <button onClick={onDone}>Cancel</button>
                <button disabled={!label.trim() || !queryIri} onClick={add}>
                    Add widget
                </button>
            </div>
        </div>
    );
}

export function DashboardView() {
    const openPage = useDashboards((s) => s.openPage);
    const conn = useConnection();
    const [dash, setDash] = useState<DashboardDef | null>(null);
    const [saved, setSaved] = useState<SavedQuery[]>([]);
    const [wizard, setWizard] = useState(false);
    const [nonce, setNonce] = useState(0);
    const refresh = useCallback(() => setNonce((n) => n + 1), []);

    useEffect(() => {
        const ep = conn.active();
        if (!ep || !openPage) return;
        fetchDashboard(ep, openPage).then(setDash);
        listSavedQueries(ep)
            .then(setSaved)
            .catch(() => setSaved([]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openPage, nonce]);

    if (!openPage) return null;
    const close = () => useDashboards.setState({ openPage: null });

    return (
        <div className="data-grid dashboard-view">
            <div className="grid-head">
                <span className="panel-title" style={{ margin: 0 }}>
                    {dash?.label ?? '…'} <span className="term-meta">dashboard · live</span>
                </span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button className="ghost" onClick={() => setWizard(true)}>
                        ＋ Widget
                    </button>
                    <button className="ghost" onClick={close}>
                        Close
                    </button>
                </span>
            </div>
            <div className="grid-scroll dashboard-grid">
                {wizard && dash && (
                    <WidgetWizard
                        dash={dash}
                        saved={saved}
                        onDone={() => {
                            setWizard(false);
                            refresh();
                        }}
                    />
                )}
                {dash?.widgets.map((w) => (
                    <Widget
                        key={w.iri}
                        w={w}
                        saved={saved}
                        onRemove={async () => {
                            const ep = conn.active();
                            if (!ep) return;
                            await cmdRemoveWidget(ep, dash.iri, w.iri);
                            refresh();
                        }}
                    />
                ))}
                {dash && dash.widgets.length === 0 && !wizard && (
                    <div className="placeholder" style={{ padding: 24 }}>
                        Empty page — add a widget from a saved query.
                    </div>
                )}
            </div>
        </div>
    );
}

export function DashboardsPanel() {
    const conn = useConnection();
    const openPage = useDashboards((s) => s.openPage);
    const [pages, setPages] = useState<{ iri: string; label: string; widgetCount: number }[] | null>(null);
    const [adding, setAdding] = useState(false);
    const [label, setLabel] = useState('');
    const [nonce, setNonce] = useState(0);

    // closing a dashboard returns to the list — refresh counts
    useEffect(() => {
        if (openPage === null) setNonce((n) => n + 1);
    }, [openPage]);

    useEffect(() => {
        const ep = conn.active();
        if (!ep) return;
        listDashboards(ep).then(setPages);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conn.activeId, nonce]);

    if (conn.status !== 'connected') return <div className="placeholder">Connect to an endpoint to browse</div>;

    const createPage = async () => {
        const ep = conn.active();
        if (!ep || !label.trim()) return;
        const iri = await cmdCreateDashboard(ep, label.trim());
        setLabel('');
        setAdding(false);
        setNonce((n) => n + 1);
        openDashboard(iri);
    };

    return (
        <div>
            {!pages ? (
                <div className="tree-loading">loading…</div>
            ) : (
                <ul className="instance-list" style={{ marginLeft: 0, borderLeft: 'none' }}>
                    {pages.map((p) => (
                        <li key={p.iri} title={p.iri} onClick={() => openDashboard(p.iri)}>
                            ▦ {p.label}
                            <span className="count" style={{ marginLeft: 6 }}>
                                {p.widgetCount} widgets
                            </span>
                        </li>
                    ))}
                    {pages.length === 0 && <li className="tree-loading">no dashboards yet</li>}
                </ul>
            )}
            {adding ? (
                <div className="ext-form">
                    <input
                        autoFocus
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="Dashboard name"
                        style={{ width: '100%' }}
                    />
                    <div className="modal-row" style={{ justifyContent: 'flex-end' }}>
                        <button onClick={() => setAdding(false)}>Cancel</button>
                        <button disabled={!label.trim()} onClick={createPage}>
                            Create
                        </button>
                    </div>
                </div>
            ) : (
                <button className="ghost" style={{ marginTop: 6 }} onClick={() => setAdding(true)}>
                    ＋ New dashboard
                </button>
            )}
        </div>
    );
}
