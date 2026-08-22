import { useState } from 'react';
import { useConnection } from '../state/connection';
import { oxigraphEndpoint } from '../rdf/sparqlClient';

export function ConnectionBar() {
  const { endpoints, activeId, status, statusMessage, graphs, activeGraph, connect, addEndpoint, setActiveGraph } =
    useConnection();
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('http://localhost:7880');
  const [name, setName] = useState('');

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
      <button className="ghost" onClick={() => setAdding(!adding)}>
        {adding ? 'Cancel' : '+ Endpoint'}
      </button>
      {adding && (
        <span className="add-form">
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Oxigraph base URL" value={url} onChange={(e) => setUrl(e.target.value)} size={32} />
          <button
            onClick={() => {
              if (!url) return;
              addEndpoint(oxigraphEndpoint(url, name || url));
              setAdding(false);
              setName('');
            }}
          >
            Add
          </button>
        </span>
      )}
    </header>
  );
}
