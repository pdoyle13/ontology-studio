import { useEffect } from 'react';
import { ConnectionBar } from './components/ConnectionBar';
import { AgentPanel } from './components/AgentPanel';
import { useUi } from './state/ui';
import { useHistory } from './state/history';
import { useGraph } from './state/graph';
import { SidebarTabs } from './components/SidebarTabs';
import { ResourcePanel } from './components/ResourcePanel';
import { GraphCanvas } from './components/GraphCanvas';
import { SparqlDrawer } from './components/SparqlDrawer';
import { ContextMenu } from './components/ContextMenu';
import { Modals } from './components/Modal';
import { DataGrid } from './components/DataGrid';
import { Omnibox } from './components/Omnibox';
import { useConnection } from './state/connection';
import { startCollab } from './state/collab';
import { startIdentity } from './state/identity';
import './App.css';

export default function App() {
  const status = useConnection((s) => s.status);
  const rightTab = useUi((s) => s.rightTab);
  const setRightTab = useUi((s) => s.setRightTab);

  useEffect(() => {
    startIdentity();
    startCollab();
  }, []);

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
            <>
              <GraphCanvas />
              <DataGrid />
            </>
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
      <ContextMenu />
      <Modals />
      <Omnibox />
    </div>
  );
}
