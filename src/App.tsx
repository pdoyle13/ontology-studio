import { ConnectionBar } from './components/ConnectionBar';
import { useConnection } from './state/connection';
import './App.css';

export default function App() {
  const status = useConnection((s) => s.status);

  return (
    <div className="app">
      <ConnectionBar />
      <div className="workspace">
        <aside className="sidebar">
          <div className="panel-title">Classes</div>
          <div className="placeholder">
            {status === 'connected' ? 'Class tree — next iteration' : 'Connect to an endpoint to browse'}
          </div>
        </aside>
        <main className="canvas-area">
          <div className="placeholder center">
            {status === 'connected'
              ? 'Graph canvas — drop a resource here (next iteration)'
              : 'Ontology Studio — connect to Oxigraph to begin'}
          </div>
        </main>
        <aside className="inspector">
          <div className="panel-title">Inspector</div>
          <div className="placeholder">Select a resource to view its properties</div>
        </aside>
      </div>
      <footer className="sparql-drawer">
        <div className="panel-title">SPARQL</div>
        <div className="placeholder">Query drawer — next iteration</div>
      </footer>
    </div>
  );
}
