// SHACL validation: pull the active scope, validate client-side with
// rdf-validate-shacl (shapes + data live in the same graph), keep the report.

import { create } from 'zustand';
import { Parser, Store } from 'n3';
import SHACLValidator from 'rdf-validate-shacl';
import { construct } from '../rdf/sparqlClient';
import { useConnection } from './connection';

export interface Violation {
  focusNode: string;
  path: string | null;
  message: string;
  severity: string; // Violation | Warning | Info (local name)
  sourceShape: string | null;
}

interface ValidationState {
  violations: Violation[];
  lastRun: number | null; // triple count validated
  running: boolean;
  error: string | null;
  validate: () => Promise<void>;
  clear: () => void;
  violationsFor: (iri: string) => Violation[];
}

export const useValidation = create<ValidationState>((set, get) => ({
  violations: [],
  lastRun: null,
  running: false,
  error: null,

  validate: async () => {
    const conn = useConnection.getState();
    const ep = conn.active();
    if (!ep) return;
    set({ running: true, error: null });
    try {
      const q = conn.activeGraph
        ? `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${conn.activeGraph}> { ?s ?p ?o } }`
        : `CONSTRUCT { ?s ?p ?o } WHERE { { ?s ?p ?o } UNION { GRAPH ?g { ?s ?p ?o } } }`;
      const turtle = await construct(ep, q);
      const quads = new Parser().parse(turtle);
      const store = new Store(quads);
      // shapes and data share the graph — pass the same dataset for both
      const validator = new SHACLValidator(store);
      const report = await validator.validate(store);
      const violations: Violation[] = report.results.map((r: (typeof report.results)[number]) => ({
        focusNode: r.focusNode?.value ?? '(unknown)',
        path: r.path?.value ?? null,
        message:
          r.message.map((m: { value: string }) => m.value).join('; ') ||
          (r.sourceConstraintComponent?.value.split('#').pop() ?? 'constraint violated'),
        severity: r.severity?.value.split('#').pop() ?? 'Violation',
        sourceShape: r.sourceShape?.value ?? null,
      }));
      set({ violations, lastRun: quads.length, running: false });
    } catch (e) {
      set({ error: (e as Error).message, running: false });
    }
  },

  clear: () => set({ violations: [], lastRun: null, error: null }),

  violationsFor: (iri) => get().violations.filter((v) => v.focusNode === iri),
}));

// Reset the report when scope changes (stale results are worse than none).
useConnection.subscribe((state, prev) => {
  if (state.activeGraph !== prev.activeGraph || state.activeId !== prev.activeId) {
    useValidation.getState().clear();
  }
});
