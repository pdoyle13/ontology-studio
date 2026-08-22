// UI/model state: selected resource, hydrated descriptions, class list, prefixes.

import { create } from 'zustand';
import { PrefixMap } from '../rdf/prefixes';
import type { ClassInfo, ResourceDescription } from '../rdf/queries';
import { fetchClasses, describeResource } from '../rdf/queries';
import { useConnection } from './connection';

export interface GraphState {
  prefixes: PrefixMap;
  classes: ClassInfo[];
  classesLoading: boolean;
  selected: string | null; // IRI of selected resource
  description: ResourceDescription | null;
  descriptionLoading: boolean;
  error: string | null;
  loadClasses: () => Promise<void>;
  selectResource: (iri: string | null) => Promise<void>;
  refreshSelected: () => Promise<void>;
}

export const useGraph = create<GraphState>((set, get) => ({
  prefixes: new PrefixMap(),
  classes: [],
  classesLoading: false,
  selected: null,
  description: null,
  descriptionLoading: false,
  error: null,

  loadClasses: async () => {
    const conn = useConnection.getState();
    const ep = conn.active();
    if (!ep) return;
    const scope = conn.activeGraph;
    set({ classesLoading: true, error: null });
    try {
      const classes = await fetchClasses(ep, scope);
      // discard stale responses: the graph scope may have changed mid-flight
      if (useConnection.getState().activeGraph !== scope) return;
      const prefixes = get().prefixes;
      for (const c of classes) prefixes.learnNamespace(c.iri);
      set({ classes, classesLoading: false });
    } catch (e) {
      set({ classesLoading: false, error: (e as Error).message });
    }
  },

  selectResource: async (iri) => {
    if (!iri) {
      set({ selected: null, description: null });
      return;
    }
    const conn = useConnection.getState();
    const ep = conn.active();
    if (!ep) return;
    set({ selected: iri, descriptionLoading: true, error: null });
    try {
      const description = await describeResource(ep, conn.activeGraph, iri);
      // ignore stale responses if selection moved on
      if (get().selected === iri) set({ description, descriptionLoading: false });
    } catch (e) {
      set({ descriptionLoading: false, error: (e as Error).message });
    }
  },

  refreshSelected: async () => {
    const iri = get().selected;
    if (iri) await get().selectResource(iri);
  },
}));

// Reload classes whenever connection or graph scope changes.
useConnection.subscribe((state, prev) => {
  if (state.status === 'connected' && (state.status !== prev.status || state.activeGraph !== prev.activeGraph)) {
    useGraph.getState().loadClasses();
    useGraph.getState().selectResource(null);
  }
});
