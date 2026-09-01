// Universal spreadsheet import: any class-based asset type. Auto-maps headers
// to shape fields, lets you override per column, validates every row before
// anything writes, imports as one undoable batch, and remembers the mapping
// as a template for next time.

import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { useConnection } from '../state/connection';
import { fetchShapesForClasses, type PropertyShapeInfo } from '../rdf/shacl';
import { fetchInstances } from '../rdf/queries';
import { parseCsv, mapHeaders, type ColumnMap } from '../rdf/csvImport';
import {
    labelField,
    validateClassRows,
    buildClassTriples,
    cmdImportInstances,
    saveTemplate,
    loadTemplate,
    applyTemplate,
    type MappingTemplate,
} from '../rdf/classImport';
import { displayName } from '../rdf/display';

interface WizState {
    open: boolean;
    classIri: string | null;
    onDone: (() => void) | null;
}
export const useImportWizard = create<WizState>(() => ({ open: false, classIri: null, onDone: null }));
export const openImportWizard = (classIri: string, onDone?: () => void) =>
    useImportWizard.setState({ open: true, classIri, onDone: onDone ?? null });

const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';

export function ImportWizard() {
    const { open, classIri, onDone } = useImportWizard();
    const conn = useConnection();
    const [text, setText] = useState('');
    const [fields, setFields] = useState<PropertyShapeInfo[]>([]);
    const [existing, setExisting] = useState<Set<string>>(new Set());
    const [overrides, setOverrides] = useState<MappingTemplate>({});
    const [template, setTemplate] = useState<MappingTemplate | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!open || !classIri) return;
        setText('');
        setError('');
        setOverrides({});
        const ep = conn.active();
        if (!ep) return;
        fetchShapesForClasses(ep, null, [classIri])
            .then((shapes) => setFields([labelField(), ...(shapes[0]?.properties ?? [])]))
            .catch(() => setFields([labelField()]));
        fetchInstances(ep, conn.activeGraph, classIri, '', 2000)
            .then((r) => setExisting(new Set(r.map((i) => i.label ?? '').filter(Boolean))))
            .catch(() => setExisting(new Set()));
        loadTemplate(ep, classIri).then(setTemplate);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, classIri]);

    const preview = useMemo(() => {
        if (!text.trim() || !classIri || fields.length === 0) return null;
        const rows = parseCsv(text);
        if (rows.length < 2) return null;
        const headers = rows[0];
        let map: ColumnMap = mapHeaders(headers, fields);
        map = applyTemplate(headers, map, fields, template);
        map = applyTemplate(headers, map, fields, overrides);
        const labelIdx = map.columns.findIndex((f) => f?.path === RDFS_LABEL);
        if (labelIdx < 0) return { headers, headerError: 'no column maps to Label' } as const;
        const dataRows = rows.slice(1);
        const reports = validateClassRows(dataRows, map, { classIri, existingLabels: existing });
        return {
            headers,
            rows,
            dataRows,
            map,
            reports,
            valid: reports.filter((r) => !r.errors.length).length,
        } as const;
    }, [text, classIri, fields, existing, template, overrides]);

    // near-duplicate hints: reconcile valid labels against the whole estate
    const [similar, setSimilar] = useState<Record<number, string>>({});
    useEffect(() => {
        setSimilar({});
        if (!preview || 'headerError' in preview) return;
        const queries: Record<string, { query: string; limit: number }> = {};
        preview.reports
            .filter((r) => !r.errors.length && r.label)
            .slice(0, 50)
            .forEach((r) => {
                queries[`q${r.index}`] = { query: r.label, limit: 1 };
            });
        if (Object.keys(queries).length === 0) return;
        const t = setTimeout(async () => {
            try {
                const res = await fetch('/api/reconcile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ queries }),
                });
                const json = await res.json();
                const found: Record<number, string> = {};
                for (const [k, v] of Object.entries(json) as [
                    string,
                    { result: { name: string; score: number; match: boolean }[] },
                ][]) {
                    const top = v.result?.[0];
                    if (top && !top.match && top.score >= 60) found[Number(k.slice(1))] = top.name;
                }
                setSimilar(found);
            } catch {
                /* hints only */
            }
        }, 400);
        return () => clearTimeout(t);
    }, [preview]);

    if (!open || !classIri) return null;
    const close = () => useImportWizard.setState({ open: false, onDone: null });

    const importNow = async () => {
        const ep = conn.active();
        if (!ep || !preview || 'headerError' in preview || !preview.valid) return;
        setBusy(true);
        setError('');
        try {
            const { triples, imported } = buildClassTriples(preview.dataRows, preview.map, preview.reports, {
                classIri,
            });
            await cmdImportInstances(ep, conn.activeGraph, triples, imported);
            // remember the effective mapping for next time
            const effective: MappingTemplate = {};
            preview.headers.forEach((h, i) => {
                effective[h.trim()] = preview.map.columns[i]?.path ?? '';
            });
            await saveTemplate(ep, classIri, effective).catch(() => {});
            onDone?.();
            close();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={close}>
            <div
                className="modal"
                style={{ width: 740, maxHeight: '85vh', overflowY: 'auto' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-title">Import {displayName(classIri)} from spreadsheet</div>
                <div className="term-meta" style={{ marginBottom: 6 }}>
                    CSV with a header row. A column must map to Label; other columns map to shape fields by name —
                    adjust below.
                    {template && ' A saved mapping template for this type was applied.'}
                </div>
                <div className="modal-row">
                    <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(e) => e.target.files?.[0]?.text().then(setText)}
                    />
                </div>
                <textarea
                    className="field-textarea csv-input"
                    rows={6}
                    placeholder="Paste CSV here…"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                />
                {preview && 'headerError' in preview && <div className="err-text">{preview.headerError}</div>}
                {preview && !('headerError' in preview) && (
                    <>
                        <div className="mapping-row">
                            {preview.headers.map((h, i) => (
                                <label key={i} className="mapping-cell">
                                    <span className="term-meta">{h}</span>
                                    <select
                                        value={preview.map.columns[i]?.path ?? ''}
                                        onChange={(e) => setOverrides((o) => ({ ...o, [h.trim()]: e.target.value }))}
                                    >
                                        <option value="">— ignore —</option>
                                        {fields.map((f) => (
                                            <option key={f.path} value={f.path}>
                                                {f.name ?? displayName(f.path)}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            ))}
                        </div>
                        <div className="term-meta" style={{ margin: '6px 0' }}>
                            {preview.valid} of {preview.dataRows.length} rows valid
                        </div>
                        <div className="grid-scroll" style={{ maxHeight: 220 }}>
                            <table className="result-table csv-preview">
                                <thead>
                                    <tr>
                                        <th></th>
                                        {preview.headers.map((h, i) => (
                                            <th key={i}>{h}</th>
                                        ))}
                                        <th>problems</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {preview.reports.map((rep) => (
                                        <tr key={rep.index} className={rep.errors.length ? 'csv-bad' : 'csv-ok'}>
                                            <td>{rep.errors.length ? '✕' : '✓'}</td>
                                            {preview.dataRows[rep.index].map((c, i) => (
                                                <td key={i} className="term-literal">
                                                    {c}
                                                </td>
                                            ))}
                                            <td className="err-text">
                                                {rep.errors.join('; ')}
                                                {!rep.errors.length && similar[rep.index] && (
                                                    <span className="term-meta">
                                                        similar existing: {similar[rep.index]}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
                {error && (
                    <div className="err-text" style={{ marginTop: 8 }}>
                        {error}
                    </div>
                )}
                <div className="modal-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
                    <button onClick={close}>Cancel</button>
                    <button
                        disabled={busy || !preview || 'headerError' in preview || !preview.valid}
                        onClick={importNow}
                    >
                        {busy
                            ? 'Importing…'
                            : preview && !('headerError' in preview)
                              ? `Import ${preview.valid} rows`
                              : 'Import'}
                    </button>
                </div>
            </div>
        </div>
    );
}
