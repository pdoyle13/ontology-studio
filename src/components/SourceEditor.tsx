// Raw source editor: the active graph as Turtle, edited as text, applied as
// a computed diff (undoable). Live parse status; RDF 1.2 quoted-triple
// documents apply as a journaled full replace instead.

import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { useConnection } from '../state/connection';
import { useGraph } from '../state/graph';
import { exportGraphTurtle } from '../rdf/importExport';
import { computeSourceDiff, cmdApplySourceDiff, cmdReplaceGraphSource, type SourceDiff } from '../rdf/sourceEdit';
import { createTurtleEditor, type CompletionTerm } from './cmTurtle';
import type { EditorView } from '@codemirror/view';
import { displayName } from '../rdf/display';

interface SrcState {
  open: boolean;
}
export const useSourceEditor = create<SrcState>(() => ({ open: false }));
export const openSourceEditor = () => useSourceEditor.setState({ open: true });

export function SourceEditor() {
  const open = useSourceEditor((s) => s.open);
  const conn = useConnection();
  const { prefixes, loadClasses, refreshSelected } = useGraph();
  const [original, setOriginal] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { classes } = useGraph();

  // graph-aware completions: classes (and their prefixed forms) from the store
  const graphTerms = (): CompletionTerm[] => {
    const { prefixes: pfx } = useGraph.getState();
    return classes.flatMap((c) => {
      const short = pfx.shrink(c.iri);
      return [
        { label: short !== c.iri ? short : `<${c.iri}>`, detail: displayName(c.iri, c.label), type: 'class' as const },
      ];
    });
  };

  // mount CodeMirror once the source has loaded
  useEffect(() => {
    if (!open || loading || !hostRef.current) return;
    viewRef.current?.destroy();
    viewRef.current = createTurtleEditor({
      parent: hostRef.current,
      doc: original,
      onChange: setText,
      graphTerms,
    });
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, original]);

  useEffect(() => {
    if (!open) return;
    const ep = conn.active();
    if (!ep) return;
    setLoading(true);
    setError('');
    exportGraphTurtle(ep, conn.activeGraph, prefixes.entries())
      .then((ttl) => {
        setOriginal(ttl);
        setText(ttl);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conn.activeGraph]);

  const diff = useMemo<SourceDiff | { error: string } | null>(() => {
    if (!open || loading || text === original) return null;
    try {
      return computeSourceDiff(original, text);
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [open, loading, text, original]);

  if (!open) return null;
  const close = () => useSourceEditor.setState({ open: false });

  const apply = async () => {
    const ep = conn.active();
    if (!ep || !diff || 'error' in diff) return;
    setBusy(true);
    setError('');
    try {
      if (diff.mode === 'replace') {
        if (!conn.activeGraph) throw new Error('replace mode needs a named graph selected');
        await cmdReplaceGraphSource(ep, conn.activeGraph, original, diff.newSource ?? text);
      } else {
        await cmdApplySourceDiff(ep, conn.activeGraph, diff);
      }
      await Promise.all([loadClasses(), refreshSelected()]);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const status =
    diff === null
      ? 'no changes'
      : 'error' in diff
      ? `parse error: ${diff.error?.slice(0, 120) ?? ''}`
      : diff.mode === 'replace'
      ? 'RDF 1.2 statements present — full graph replace on apply'
      : `+${diff.added.length} −${diff.removed.length} triples`;

  return (
    <div className="data-grid source-editor">
      <div className="grid-head">
        <span className="panel-title" style={{ margin: 0 }}>
          Source — {conn.activeGraph ? conn.activeGraph.split('/').pop() : 'default graph'}{' '}
          <span className="term-meta">Turtle · diff-applied · RDF 1.2 aware</span>
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className={`term-meta ${diff && 'error' in diff ? 'err-text' : ''}`}>{loading ? 'loading…' : status}</span>
          <button
            disabled={busy || loading || !diff || 'error' in diff}
            onClick={apply}
            title="Apply the computed diff (undoable, journaled)"
          >
            {busy ? 'Applying…' : 'Apply'}
          </button>
          <button className="ghost" onClick={close}>Close</button>
        </span>
      </div>
      {error && <div className="err-text" style={{ padding: '4px 10px' }}>{error}</div>}
      {loading && <div className="tree-loading" style={{ padding: 12 }}>loading source…</div>}
      <div ref={hostRef} className="source-cm" />
    </div>
  );
}
