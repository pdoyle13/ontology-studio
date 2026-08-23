// Workspaces: UX presets over one build — never license tiers. A workspace
// decides which sidebar tabs show, which right panel opens first, and whether
// write affordances render. Permissions stay enforced server-side by role.

import { create } from 'zustand';
import { useUi } from './ui';

export type Workspace = 'ask' | 'model' | 'govern' | 'explore' | 'integrate';
export type SidebarTab = 'classes' | 'shapes' | 'assets' | 'taxonomy' | 'rules' | 'dashboards' | 'quality' | 'issues' | 'sql' | 'reviews';

export interface WorkspaceSpec {
  id: Workspace;
  label: string;
  hint: string;
  tabs: SidebarTab[];
  defaultTab: SidebarTab;
  rightTab: 'inspector' | 'agent';
  readOnly: boolean;
}

export const WORKSPACES: Record<Workspace, WorkspaceSpec> = {
  ask: {
    id: 'ask',
    label: 'Ask',
    hint: 'Conversational — the agent plans across every source',
    tabs: ['classes', 'assets'],
    defaultTab: 'classes',
    rightTab: 'agent',
    readOnly: false,
  },
  model: {
    id: 'model',
    label: 'Model',
    hint: 'Ontologies, shapes, assets, rules',
    tabs: ['classes', 'shapes', 'assets', 'taxonomy', 'rules', 'dashboards', 'issues'],
    defaultTab: 'classes',
    rightTab: 'inspector',
    readOnly: false,
  },
  govern: {
    id: 'govern',
    label: 'Govern',
    hint: 'Reviews, audit, quality',
    tabs: ['reviews', 'quality', 'issues', 'classes'],
    defaultTab: 'reviews',
    rightTab: 'inspector',
    readOnly: false,
  },
  explore: {
    id: 'explore',
    label: 'Explore',
    hint: 'Search, browse, dashboards — read-only',
    tabs: ['assets', 'dashboards', 'classes', 'taxonomy'],
    defaultTab: 'assets',
    rightTab: 'agent',
    readOnly: true,
  },
  integrate: {
    id: 'integrate',
    label: 'Integrate',
    hint: 'APIs, consoles, connectors',
    tabs: ['sql', 'classes'],
    defaultTab: 'sql',
    rightTab: 'agent',
    readOnly: false,
  },
};

const ROLE_DEFAULT: Record<string, Workspace> = {
  admin: 'integrate',
  steward: 'govern',
  editor: 'model',
  viewer: 'explore',
};

function initialWorkspace(): Workspace {
  const fromUrl = new URLSearchParams(window.location.search).get('workspace');
  if (fromUrl && fromUrl in WORKSPACES) return fromUrl as Workspace;
  const stored = localStorage.getItem('studio.workspace');
  if (stored && stored in WORKSPACES) return stored as Workspace;
  return 'ask';
}

export function roleDefaultWorkspace(role: string): Workspace {
  return ROLE_DEFAULT[role] ?? 'ask';
}

interface WorkspaceState {
  workspace: Workspace;
  setWorkspace: (w: Workspace) => void;
  spec: () => WorkspaceSpec;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  workspace: initialWorkspace(),
  setWorkspace: (workspace) => {
    localStorage.setItem('studio.workspace', workspace);
    const url = new URL(window.location.href);
    url.searchParams.set('workspace', workspace);
    window.history.replaceState(null, '', url.toString());
    set({ workspace });
    const spec = WORKSPACES[workspace];
    useUi.getState().setRightTab(spec.rightTab);
    document.body.classList.toggle('ws-readonly', spec.readOnly);
  },
  spec: () => WORKSPACES[get().workspace],
}));

// apply the read-only class for the initial workspace too
document.body.classList.toggle('ws-readonly', WORKSPACES[useWorkspace.getState().workspace].readOnly);
