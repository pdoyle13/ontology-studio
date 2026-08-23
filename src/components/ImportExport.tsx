import { useRef, useState } from 'react';
import { useConnection } from '../state/connection';
import { useGraph } from '../state/graph';
import { parseTurtle, importQuads, fetchRdfFromUrl, exportGraphTurtle, exportGraphJsonLd, downloadText } from '../rdf/importExport';
import { localName } from '../rdf/prefixes';

type Phase = 'idle' | 'parsing' | 'uploading' | 'done' | 'error';

export function ImportExportDialog({ onClose }: { onClose: () => void }) {
  const conn = useConnection();
  const { prefixes, loadClasses } = useGraph();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [targetGraph, setTargetGraph] = useState(conn.activeGraph ?? '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(0);

  const runImport = async (text: string, sourceName: string) => {
    const ep = conn.active();
    if (!ep) return;
    try {
      setPhase('parsing');
      setMessage(`Parsing ${sourceName}…`);
      const { quads, prefixes: found } = parseTurtle(text);
      for (const [p, ns] of Object.entries(found)) prefixes.register(p, ns);
      setPhase('uploading');
      setMessage(`Uploading ${quads.length.toLocaleString()} triples…`);
      const graph = targetGraph.trim() || null;
      await importQuads(ep, graph, quads, (done, total) => setProgress(done / total));
      setPhase('done');
      setMessage(`Imported ${quads.length.toLocaleString()} triples${graph ? ` into ${graph}` : ' into default graph'}.`);
      await conn.refreshGraphs();
      await loadClasses();
    } catch (e) {
      setPhase('error');
      setMessage((e as Error).message);
    }
  };

  const onFile = async (f: File) => {
    const text = await f.text();
    runImport(text, f.name);
  };

  const onUrl = async () => {
    if (!url.trim()) return;
    try {
      setPhase('parsing');
      setMessage('Fetching…');
      const text = await fetchRdfFromUrl(url.trim());
      await runImport(text, localName(url));
    } catch (e) {
      setPhase('error');
      setMessage((e as Error).message);
    }
  };

  const onExport = async () => {
    const ep = conn.active();
    if (!ep) return;
    try {
      setPhase('parsing');
      setMessage('Exporting…');
      const ttl = await exportGraphTurtle(ep, conn.activeGraph, prefixes.entries());
      const name = conn.activeGraph ? `${localName(conn.activeGraph)}.ttl` : 'default-graph.ttl';
      downloadText(name, ttl);
      setPhase('done');
      setMessage(`Exported ${name}.`);
    } catch (e) {
      setPhase('error');
      setMessage((e as Error).message);
    }
  };

  const busy = phase === 'parsing' || phase === 'uploading';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Import / Export</div>

        <div className="panel-title">Import Turtle / N-Triples</div>
        <label className="field-label">
          Target graph IRI <span className="term-meta">(empty = default graph)</span>
        </label>
        <input
          value={targetGraph}
          onChange={(e) => setTargetGraph(e.target.value)}
          placeholder="https://example.org/graphs/my-ontology"
          style={{ width: '100%' }}
        />
        <div className="modal-row">
          <input ref={fileRef} type="file" accept=".ttl,.nt,.turtle,text/turtle" style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <button disabled={busy} onClick={() => fileRef.current?.click()}>Choose file…</button>
          <span className="term-meta">or</span>
          <input
            placeholder="https://…/ontology.ttl"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{ flex: 1 }}
            onKeyDown={(e) => e.key === 'Enter' && onUrl()}
          />
          <button disabled={busy || !url.trim()} onClick={onUrl}>Fetch</button>
        </div>

        <div className="panel-title" style={{ marginTop: 14 }}>Export current scope</div>
        <div className="modal-row">
          <button disabled={busy} onClick={onExport}>
            Download {conn.activeGraph ? localName(conn.activeGraph) : 'default graph'} as Turtle
          </button>
          <button
            className="ghost"
            onClick={async () => {
              const ep = conn.active();
              if (!ep) return;
              const doc = await exportGraphJsonLd(ep, conn.activeGraph, prefixes);
              downloadText('graph.jsonld', doc);
            }}
          >
            as JSON-LD
          </button>
        </div>

        {phase !== 'idle' && (
          <div className={`import-status ${phase === 'error' ? 'err-text' : ''}`}>
            {phase === 'uploading' && (
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
            {message}
          </div>
        )}

        <div className="modal-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
