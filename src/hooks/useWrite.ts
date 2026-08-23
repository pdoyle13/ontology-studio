// Shared write-action hook: runs an undoable command, refreshes the selected
// resource, surfaces errors. Replaces the three per-component copies.

import { useState } from 'react';
import { useConnection } from '../state/connection';
import { useGraph } from '../state/graph';

export function useWrite() {
  const conn = useConnection();
  const { refreshSelected } = useGraph();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    const ep = conn.active();
    if (!ep) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refreshSelected();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return { run, busy, error, ep: conn.active(), graph: conn.activeGraph };
}
