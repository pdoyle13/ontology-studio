import { useState } from 'react';
import { useConnection } from '../state/connection';
import { oxigraphEndpoint } from '../rdf/sparqlClient';
import { ImportExportDialog } from './ImportExport';

export function ConnectionBar() {
  const [showImport, setShowImport] = useState(false);
  const { endpoints, activeId, status, statusMessage, graphs, activeGraph, connect, addEndpoint, setActiveGraph } =
    useConnection();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<'oxigraph' | 'generic'>('oxigraph');
  const [url, setUrl] = useState('http://localhost:7880');
  const [updateUrl, setUpdateUrl] = useState('');
  const [name, setName] = useState('');

  const add = () => {
    if (!url.trim()) return;
    if (kind === 'oxigraph') {
      addEndpoint(oxigraphEndpoint(url.trim(), name || url.trim()));
    } else {
      const q = url.trim();
      addEndpoint({
        id: q,
        name: name || q,
        queryUrl: q,
        updateUrl: updateUrl.trim() || undefined,
      });
    }
    setAdding(false);
    setName('');
    setUpdateUrl('');
  };

  const dotClass = { connected: 'dot ok', connecting: 'dot busy', error: 'dot err', disconnected: 'dot' }[status];

  return (
    <header className="connection-bar">
      <span className="brand">Ontology Studio</span>
      <span className={dotClass} title={statusMessage} />
      <select
        value={activeId ?? ''}
        onChange={(e) => e.target.value && connect(e.target.value)}
        className="ep-select"
      >
        <option value="" disabled>
          Select endpoint…
        </option>
        {endpoints.map((ep) => (
          <option key={ep.id} value={ep.id}>
            {ep.name}
          </option>
        ))}
      </select>
      {status === 'connected' && (
        <select
          value={activeGraph ?? ''}
          onChange={(e) => setActiveGraph(e.target.value || null)}
          className="graph-select"
          title="Named graph scope"
        >
          <option value="">default graph</option>
          {graphs.map((g) => (
            <option key={g.graph} value={g.graph}>
              {g.graph} ({g.triples.toLocaleString()})
            </option>
          ))}
        </select>
      )}
      {status === 'error' && <span className="status-msg err-text">{statusMessage}</span>}
      {status === 'connected' && (
        <button className="ghost" onClick={() => setShowImport(true)}>
          Import / Export
        </button>
      )}
      <button className="ghost" onClick={() => setAdding(!adding)}>
        {adding ? 'Cancel' : '+ Endpoint'}
      </button>
      {showImport && <ImportExportDialog onClose={() => setShowImport(false)} />}
      {adding && (
        <span className="add-form">
          <select value={kind} onChange={(e) => setKind(e.target.value as 'oxigraph' | 'generic')}>
            <option value="oxigraph">Oxigraph</option>
            <option value="generic">Generic SPARQL</option>
          </select>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} size={12} />
          <input
            placeholder={kind === 'oxigraph' ? 'Oxigraph base URL' : 'Query endpoint URL'}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            size={30}
          />
          {kind === 'generic' && (
            <input
              placeholder="Update URL (blank = read-only)"
              value={updateUrl}
              onChange={(e) => setUpdateUrl(e.target.value)}
              size={24}
            />
          )}
          <button onClick={add}>Add</button>
          {kind === 'generic' && (
            <button
              className="ghost"
              title="Preset: Wikidata (read-only)"
              onClick={() => {
                setName('Wikidata (read-only)');
                setUrl('https://query.wikidata.org/sparql');
                setUpdateUrl('');
              }}
            >
              Wikidata
            </button>
          )}
        </span>
      )}
    </header>
  );
}
