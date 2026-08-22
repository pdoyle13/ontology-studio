import { useEffect, useState } from 'react';
import { ConnectionBar } from './components/ConnectionBar';
import { AgentPanel } from './components/AgentPanel';
import { useHistory } from './state/history';
import { useGraph } from './state/graph';
import { SidebarTabs } from './components/SidebarTabs';
import { ResourcePanel } from './components/ResourcePanel';
import { GraphCanvas } from './components/GraphCanvas';
import { SparqlDrawer } from './components/SparqlDrawer';
import { useConnection } from './state/connection';
import './App.css';

export default function App() {
  const status = useConnection((s) => s.status);
  const [rightTab, setRightTab] = useState<'inspector' | 'agent'>('inspector');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        useHistory.getState().undo().then(() => useGraph.getState().refreshSelected());
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        useHistory.getState().redo().then(() => useGraph.getState().refreshSelected());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <ConnectionBar />
      <div className="workspace">
        <aside className="sidebar">
          <SidebarTabs />
        </aside>
        <main className="canvas-area">
          {status === 'connected' ? (
            <GraphCanvas />
          ) : (
            <div className="placeholder center">Ontology Studio — connect to Oxigraph to begin</div>
          )}
        </main>
        <aside className="inspector">
          <div className="tab-row">
            <button className={`tab ${rightTab === 'inspector' ? 'active' : ''}`} onClick={() => setRightTab('inspector')}>
              Inspector
            </button>
            <button className={`tab ${rightTab === 'agent' ? 'active' : ''}`} onClick={() => setRightTab('agent')}>
              ✦ Agent
            </button>
          </div>
          {rightTab === 'inspector' ? <ResourcePanel /> : <AgentPanel />}
        </aside>
      </div>
      <SparqlDrawer />
    </div>
  );
}
