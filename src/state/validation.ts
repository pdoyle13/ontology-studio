// SHACL validation: pull the active scope, validate client-side with
// rdf-validate-shacl (shapes + data live in the same graph), keep the report.

import { create } from 'zustand';
import { Parser, Store } from 'n3';
import SHACLValidator from 'rdf-validate-shacl';
import { construct, select } from '../rdf/sparqlClient';
import { useConnection } from './connection';

// Client-side validation pulls the whole scope into the browser. Beyond this
// budget (bulk data graphs, e.g. translated SQL sources) that would hang the
// tab for minutes — fail fast with guidance instead.
const TRIPLE_BUDGET = 250_000;

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
      // union scope validates PER GRAPH: each graph is a self-contained
      // shapes+data unit, and merging graphs collides same-IRI shapes into
      // multi-value properties the validator cannot process.
      const scopes: (string | null)[] = conn.activeGraph
        ? [conn.activeGraph]
        : (await select(ep, 'SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }')).bindings
            .map((b): string | null => b.g?.value ?? null)
            .concat([null]); // plus the default graph
      const counts = await Promise.all(
        scopes.map((g) =>
          select(ep, `SELECT (COUNT(?s) AS ?n) WHERE { ${g ? `GRAPH <${g}> { ?s ?p ?o }` : '?s ?p ?o'} }`)
        )
      );
      const total = counts.reduce((sum, r) => sum + Number(r.bindings[0]?.n?.value ?? 0), 0);
      if (total > TRIPLE_BUDGET) {
        set({
          running: false,
          error: `Scope holds ${total.toLocaleString()} triples — too large to validate in the browser. Select a specific graph (validation runs per graph).`,
        });
        return;
      }
      const violations: Violation[] = [];
      let checked = 0;
      for (let i = 0; i < scopes.length; i++) {
        if (Number(counts[i].bindings[0]?.n?.value ?? 0) === 0) continue;
        const g = scopes[i];
        const q = `CONSTRUCT { ?s ?p ?o } WHERE { ${g ? `GRAPH <${g}> { ?s ?p ?o }` : '?s ?p ?o'} }`;
        const turtle = await construct(ep, q);
        const quads = new Parser().parse(turtle);
        const store = new Store(quads);
        checked += quads.length;
        // shapes and data share the graph — pass the same dataset for both
        const report = await new SHACLValidator(store).validate(store);
        for (const r of report.results) {
          violations.push({
            focusNode: r.focusNode?.value ?? '(unknown)',
            path: r.path?.value ?? null,
            message:
              r.message.map((m: { value: string }) => m.value).join('; ') ||
              (r.sourceConstraintComponent?.value.split('#').pop() ?? 'constraint violated'),
            severity: r.severity?.value.split('#').pop() ?? 'Violation',
            sourceShape: r.sourceShape?.value ?? null,
          });
        }
      }
      set({ violations, lastRun: checked, running: false });
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
