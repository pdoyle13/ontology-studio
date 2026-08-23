// Spreadsheet import for taxonomies: paste or upload CSV, see a validated
// preview (per-row errors, broader resolution, column mapping), import the
// valid rows as ONE undoable command.

import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { useConnection } from '../state/connection';
import { fetchConcepts } from '../rdf/skos';
import { fetchAssetFields, cmdCreateConcepts } from '../rdf/skosExt';
import type { PropertyShapeInfo } from '../rdf/shacl';
import { parseCsv, mapHeaders, validateRows, buildImportTriples } from '../rdf/csvImport';

interface CsvState {
  open: boolean;
  scheme: string | null;
  onDone: (() => void) | null;
}
export const useCsvImport = create<CsvState>(() => ({ open: false, scheme: null, onDone: null }));
export const openCsvImport = (scheme: string, onDone?: () => void) =>
  useCsvImport.setState({ open: true, scheme, onDone: onDone ?? null });

const SAMPLE = `Label,Broader,Synonyms,Definition
Payments,,Transfers | Remittance,Money moving between parties
Card Payments,Payments,,Credit and debit rails
Wire Transfers,Payments,SWIFT,Bank-to-bank transfers`;

export function CsvImportDialog() {
  const { open, scheme, onDone } = useCsvImport();
  const conn = useConnection();
  const [text, setText] = useState('');
  const [fields, setFields] = useState<PropertyShapeInfo[]>([]);
  const [existing, setExisting] = useState<{ iri: string; label: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setText('');
    setError('');
    const ep = conn.active();
    if (!ep || !scheme) return;
    fetchAssetFields(ep, 'concept').then(setFields).catch(() => setFields([]));
    fetchConcepts(ep, conn.activeGraph, scheme).then(setExisting).catch(() => setExisting([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scheme]);

  const preview = useMemo(() => {
    if (!text.trim() || !scheme || fields.length === 0) return null;
    const rows = parseCsv(text);
    if (rows.length < 2) return null;
    const map = mapHeaders(rows[0], fields);
    if (map.prefCol < 0) return { headerError: 'no label column found (use “Label”, “Term”, or “Pref Label”)' } as const;
    const dataRows = rows.slice(1);
    const reports = validateRows(dataRows, map, { scheme, existing });
    const valid = reports.filter((r) => r.errors.length === 0).length;
    return { rows, dataRows, map, reports, valid } as const;
  }, [text, scheme, fields, existing]);

  if (!open || !scheme) return null;
  const close = () => useCsvImport.setState({ open: false, onDone: null });

  const importNow = async () => {
    const ep = conn.active();
    if (!ep || !preview || 'headerError' in preview || !preview.valid) return;
    setBusy(true);
    setError('');
    try {
      const { triples, imported } = buildImportTriples(preview.dataRows, preview.map, preview.reports, {
        scheme,
        fields,
      });
      await cmdCreateConcepts(ep, conn.activeGraph, triples, `import ${imported} concepts`);
      onDone?.();
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    f.text().then(setText);
  };

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" style={{ width: 720, maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Import concepts from spreadsheet</div>
        <div className="term-meta" style={{ marginBottom: 6 }}>
          CSV with a header row. Columns: Label (required), Broader (label of an existing concept or an earlier row),
          Synonyms (separate with |), Definition, Notation — plus any custom field by its name. Unknown columns are ignored.
        </div>
        <div className="modal-row">
          <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
          <button className="ghost" onClick={() => setText(SAMPLE)}>Paste sample</button>
        </div>
        <textarea
          className="field-textarea csv-input"
          rows={7}
          placeholder="Paste CSV here…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {preview && 'headerError' in preview && <div className="err-text">{preview.headerError}</div>}
        {preview && !('headerError' in preview) && (
          <>
            <div className="term-meta" style={{ margin: '6px 0' }}>
              {preview.valid} of {preview.dataRows.length} rows valid
              {preview.map.ignored.length > 0 && ` · ignored columns: ${preview.map.ignored.join(', ')}`}
            </div>
            <div className="grid-scroll" style={{ maxHeight: 260 }}>
              <table className="result-table csv-preview">
                <thead>
                  <tr>
                    <th></th>
                    {preview.rows[0].map((h, i) => (
                      <th key={i}>
                        {h}
                        <div className="term-meta">
                          {i === preview.map.broaderCol
                            ? 'broader'
                            : preview.map.columns[i]
                            ? preview.map.columns[i]!.name ?? 'field'
                            : 'ignored'}
                        </div>
                      </th>
                    ))}
                    <th>problems</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.reports.map((rep) => (
                    <tr key={rep.index} className={rep.errors.length ? 'csv-bad' : 'csv-ok'}>
                      <td>{rep.errors.length ? '✕' : '✓'}</td>
                      {preview.dataRows[rep.index].map((c, i) => (
                        <td key={i} className="term-literal">{c}</td>
                      ))}
                      <td className="err-text">{rep.errors.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {error && <div className="err-text" style={{ marginTop: 8 }}>{error}</div>}
        <div className="modal-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={close}>Cancel</button>
          <button
            disabled={busy || !preview || 'headerError' in preview || !preview.valid}
            onClick={importNow}
          >
            {busy ? 'Importing…' : preview && !('headerError' in preview) ? `Import ${preview.valid} rows` : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
