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
import { AssetDialog } from './components/AssetDialog';
import { ExtensionsDialog } from './components/ExtensionsDialog';
import { CsvImportDialog } from './components/CsvImportDialog';
import { ImportWizard } from './components/ImportWizard';
import { SettingsDialog } from './components/SettingsDialog';
import { MappingEditor } from './components/MappingEditor';
import { HelpDialog } from './components/HelpDialog';
import { DashboardView } from './components/DashboardsPanel';
import { SourceEditor } from './components/SourceEditor';
import { useConnection } from './state/connection';
import { useWorkspace } from './state/workspace';
import { startCollab } from './state/collab';
import { useSettings } from './state/settings';
import { startIdentity } from './state/identity';
import './App.css';

export default function App() {
  const status = useConnection((s) => s.status);
  const rightTab = useUi((s) => s.rightTab);
  const setRightTab = useUi((s) => s.setRightTab);
  const workspace = useWorkspace((s) => s.workspace);
  // Ask is agent-first: the agent IS the main surface, not a side tab
  const agentCenter = workspace === 'ask';

  useEffect(() => {
    startIdentity();
    startCollab();
  }, []);

  // settings live in the extensions graph — load them once connected
  useEffect(() => {
    const conn = useConnection.getState();
    const ep = conn.active();
    if (status === 'connected' && ep) useSettings.getState().load(ep);
  }, [status]);

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
              {agentCenter ? (
                <div className="agent-center">
                  <AgentPanel />
                </div>
              ) : (
                <GraphCanvas />
              )}
              <DataGrid />
              <DashboardView />
              <SourceEditor />
            </>
          ) : (
            <div className="placeholder center">Ontology Studio — connect to Oxigraph to begin</div>
          )}
        </main>
        <aside className="inspector">
          {agentCenter ? (
            <ResourcePanel />
          ) : (
            <>
              <div className="tab-row">
                <button className={`tab ${rightTab === 'inspector' ? 'active' : ''}`} onClick={() => setRightTab('inspector')}>
                  Inspector
                </button>
                <button className={`tab ${rightTab === 'agent' ? 'active' : ''}`} onClick={() => setRightTab('agent')}>
                  ✦ Agent
                </button>
              </div>
              {rightTab === 'inspector' ? <ResourcePanel /> : <AgentPanel />}
            </>
          )}
        </aside>
      </div>
      <SparqlDrawer />
      <ContextMenu />
      <Modals />
      <Omnibox />
      <AssetDialog />
      <ExtensionsDialog />
      <CsvImportDialog />
      <ImportWizard />
      <SettingsDialog />
      <MappingEditor />
      <HelpDialog />
    </div>
  );
}
