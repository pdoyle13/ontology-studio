// Raw source editing: a graph as Turtle text, applied back as a computed
// DIFF (delete removed triples, insert added ones — undoable, journaled)
// rather than wipe-and-reload. Sources containing RDF 1.2 quoted-triple
// syntax (<< … >>) switch to full-replace mode: Oxigraph speaks SPARQL-star
// natively, but the client parser reifies quoted terms, so a faithful
// client-side diff is not possible there yet.

import { Parser, type Quad, type Term } from 'n3';
import type { Endpoint } from './sparqlClient';
import { update } from './sparqlClient';
import { useHistory } from '../state/history';

function termToNT(t: Term): string {
  if (t.termType === 'NamedNode') return `<${t.value}>`;
  if (t.termType === 'BlankNode') return `_:${t.value}`;
  const lit = t as unknown as { value: string; language?: string; datatype?: { value: string } };
  const esc = lit.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  if (lit.language) return `"${esc}"@${lit.language}`;
  const dt = lit.datatype?.value;
  if (dt && dt !== 'http://www.w3.org/2001/XMLSchema#string') return `"${esc}"^^<${dt}>`;
  return `"${esc}"`;
}

export function quadToNT(q: Quad): string {
  return `${termToNT(q.subject)} ${termToNT(q.predicate)} ${termToNT(q.object)} .`;
}

export interface SourceDiff {
  mode: 'diff' | 'replace';
  added: string[];
  removed: string[];
  /** replace mode: the full new source, applied verbatim server-side */
  newSource?: string;
  error?: string;
}

const hasStarSyntax = (text: string) => /<<.*>>/s.test(text);

/** Pure: old source + edited source → what changes. Throws on parse errors. */
export function computeSourceDiff(oldText: string, newText: string): SourceDiff {
  if (hasStarSyntax(newText) || hasStarSyntax(oldText)) {
    // validate the new text parses (star-aware), then replace wholesale
    new Parser({ rdfStar: true } as ConstructorParameters<typeof Parser>[0]).parse(newText);
    return { mode: 'replace', added: [], removed: [], newSource: newText };
  }
  // n3 labels anonymous blank nodes from a global counter, so identical text
  // parses to different labels — canonicalize per parse (first-seen order)
  // before comparing.
  const canonical = (text: string) => {
    const quads = new Parser().parse(text);
    const relabel = new Map<string, string>();
    const name = (label: string) => {
      if (!relabel.has(label)) relabel.set(label, `c${relabel.size}`);
      return relabel.get(label)!;
    };
    return quads.map((q) => quadToNT(q).replace(/_:([A-Za-z0-9_-]+)/g, (_m, l: string) => `_:${name(l)}`));
  };
  const oldSet = new Set(canonical(oldText));
  const newSet = new Set(canonical(newText));
  const added = [...newSet].filter((l) => !oldSet.has(l));
  const removed = [...oldSet].filter((l) => !newSet.has(l));
  // SPARQL forbids blank nodes in DELETE DATA, and inserted bnodes would
  // detach from their originals — bnode-touching edits replace the graph.
  if ([...added, ...removed].some((l) => l.includes('_:'))) {
    return { mode: 'replace', added, removed, newSource: newText };
  }
  return { mode: 'diff', added, removed };
}

const wrap = (graph: string | null, t: string) => (graph ? `GRAPH <${graph}> { ${t} }` : t);

/** Apply a computed diff as ONE undoable command. */
export async function cmdApplySourceDiff(ep: Endpoint, graph: string | null, diff: SourceDiff): Promise<void> {
  if (diff.mode === 'replace') {
    // full replace: Turtle → SPARQL-star INSERT via the server passthrough.
    // Undo restores the previous full source the same way.
    throw new Error('replace mode must go through cmdReplaceGraphSource');
  }
  if (diff.added.length === 0 && diff.removed.length === 0) return;
  const parts: string[] = [];
  if (diff.removed.length) parts.push(`DELETE DATA { ${wrap(graph, diff.removed.join('\n'))} }`);
  if (diff.added.length) parts.push(`INSERT DATA { ${wrap(graph, diff.added.join('\n'))} }`);
  const forward = parts.join(' ;\n');
  const backParts: string[] = [];
  if (diff.added.length) backParts.push(`DELETE DATA { ${wrap(graph, diff.added.join('\n'))} }`);
  if (diff.removed.length) backParts.push(`INSERT DATA { ${wrap(graph, diff.removed.join('\n'))} }`);
  const backward = backParts.join(' ;\n');
  await useHistory.getState().exec({
    label: `edit source (+${diff.added.length} −${diff.removed.length})`,
    redo: () => update(ep, forward),
    undo: () => update(ep, backward),
  });
}

/** Replace a whole graph from Turtle source (RDF 1.2 path). Undo restores the old source. */
export async function cmdReplaceGraphSource(
  ep: Endpoint,
  graph: string,
  oldSource: string,
  newSource: string
): Promise<void> {
  const load = (src: string) =>
    update(ep, `DROP SILENT GRAPH <${graph}> ; INSERT DATA { GRAPH <${graph}> {\n${stripPrefixesToSparql(src)}\n} }`);
  await useHistory.getState().exec({
    label: 'replace graph source',
    redo: () => load(newSource),
    undo: () => load(oldSource),
  });
}

/** Turtle @prefix lines → SPARQL-star-compatible inline body (PREFIX is illegal inside INSERT DATA). */
export function stripPrefixesToSparql(turtle: string): string {
  // expand prefixed names is the parser's job; here we only pass through
  // documents that are already prefix-free OR use SPARQL-legal syntax.
  // Practical rule: drop @prefix lines and expand via a star-aware reserialize
  // when no star syntax; star documents must be written prefix-free.
  return turtle
    .split('\n')
    .filter((l) => !/^\s*@prefix\s/i.test(l) && !/^\s*@base\s/i.test(l))
    .join('\n');
}
