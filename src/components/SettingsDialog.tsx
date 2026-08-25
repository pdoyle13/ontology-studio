// App settings: user-configurable knobs persisted in the extensions graph.
// First resident: the system-namespace filter that keeps machinery vocabularies
// (SKOS/SHACL/R2RML/…) out of the Classes tree.

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useConnection } from '../state/connection';
import { useGraph } from '../state/graph';
import { useSettings, DEFAULT_SYSTEM_NAMESPACES } from '../state/settings';

export const useSettingsDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openSettings = () => useSettingsDialog.setState({ open: true });

export function SettingsDialog() {
  const open = useSettingsDialog((s) => s.open);
  const conn = useConnection();
  const { loadClasses } = useGraph();
  const { systemNamespaces, saveSystemNamespaces } = useSettings();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) setText(systemNamespaces.join('\n'));
  }, [open, systemNamespaces]);

  if (!open) return null;
  const close = () => useSettingsDialog.setState({ open: false });

  const save = async () => {
    const ep = conn.active();
    if (!ep) return;
    setBusy(true);
    setError('');
    try {
      await saveSystemNamespaces(ep, text.split('\n'));
      await loadClasses(); // the tree filter changed — refresh it now
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" style={{ width: 560, maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Settings</div>

        <div className="panel-title">System namespaces</div>
        <div className="term-meta" style={{ marginBottom: 6 }}>
          Classes in these namespaces are hidden from the Classes tree (they have
          their own surfaces — Taxonomy, Shapes, Mappings…). One namespace per line.
        </div>
        <textarea
          rows={9}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: 11.5 }}
        />
        <div className="modal-row">
          <button className="ghost" onClick={() => setText(DEFAULT_SYSTEM_NAMESPACES.join('\n'))}>
            Reset to defaults
          </button>
        </div>

        {error && <div className="err-text">{error}</div>}
        <div className="modal-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="ghost" onClick={close}>Cancel</button>
          <button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
