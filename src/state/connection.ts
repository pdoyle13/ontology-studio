import { create } from 'zustand';
import type { Endpoint } from '../rdf/sparqlClient';
import { oxigraphEndpoint, testConnection, listGraphs } from '../rdf/sparqlClient';

const STORAGE_KEY = 'ontology-studio.connections';

export interface ConnectionState {
  endpoints: Endpoint[];
  activeId: string | null;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  statusMessage: string;
  graphs: { graph: string; triples: number }[];
  activeGraph: string | null; // null = default graph
  addEndpoint: (ep: Endpoint) => void;
  removeEndpoint: (id: string) => void;
  connect: (id: string) => Promise<void>;
  setActiveGraph: (g: string | null) => void;
  refreshGraphs: () => Promise<void>;
  active: () => Endpoint | null;
}

function loadSaved(): Endpoint[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupted storage — fall through to defaults */ }
  return [oxigraphEndpoint('/db', 'Local Oxigraph (studio)')];
}

function persist(endpoints: Endpoint[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(endpoints));
}

export const useConnection = create<ConnectionState>((set, get) => ({
  endpoints: loadSaved(),
  activeId: null,
  status: 'disconnected',
  statusMessage: '',
  graphs: [],
  activeGraph: null,

  addEndpoint: (ep) => {
    const endpoints = [...get().endpoints.filter((e) => e.id !== ep.id), ep];
    persist(endpoints);
    set({ endpoints });
  },

  removeEndpoint: (id) => {
    const endpoints = get().endpoints.filter((e) => e.id !== id);
    persist(endpoints);
    set({ endpoints, ...(get().activeId === id ? { activeId: null, status: 'disconnected' as const } : {}) });
  },

  connect: async (id) => {
    const ep = get().endpoints.find((e) => e.id === id);
    if (!ep) return;
    set({ activeId: id, status: 'connecting', statusMessage: 'Connecting…' });
    const r = await testConnection(ep);
    if (!r.ok) {
      set({ status: 'error', statusMessage: r.message });
      return;
    }
    set({ status: 'connected', statusMessage: r.message });
    await get().refreshGraphs();
  },

  setActiveGraph: (g) => set({ activeGraph: g }),

  refreshGraphs: async () => {
    const ep = get().active();
    if (!ep) return;
    try {
      const graphs = await listGraphs(ep);
      set({ graphs });
    } catch {
      set({ graphs: [] });
    }
  },

  active: () => {
    const { endpoints, activeId } = get();
    return endpoints.find((e) => e.id === activeId) ?? null;
  },
}));
