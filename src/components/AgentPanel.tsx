// Modeling copilot chat: talks to the studio-server agent loop (Claude + SPARQL
// tools). After each reply the UI refreshes — the agent writes to the store.

import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useConnection } from '../state/connection';
import { useGraph } from '../state/graph';

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  trace?: { tool: string; input: string; ok: boolean }[];
}

interface AgentState {
  messages: ChatMsg[];
  busy: boolean;
  push: (m: ChatMsg) => void;
  setBusy: (b: boolean) => void;
  clear: () => void;
}

const useAgent = create<AgentState>((set, get) => ({
  messages: [],
  busy: false,
  push: (m) => set({ messages: [...get().messages, m] }),
  setBusy: (busy) => set({ busy }),
  clear: () => set({ messages: [] }),
}));

export function AgentPanel() {
  const conn = useConnection();
  const { loadClasses, refreshSelected } = useGraph();
  const { messages, busy, push, setBusy, clear } = useAgent();
  const [input, setInput] = useState('');
  const [available, setAvailable] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h) => setAvailable(!!h.agent))
      .catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    push({ role: 'user', content: text });
    setBusy(true);
    try {
      const history = [...useAgent.getState().messages].map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, graph: conn.activeGraph }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `${res.status}`);
      push({ role: 'assistant', content: json.reply, trace: json.trace });
      if (json.trace?.some((t: { tool: string }) => t.tool === 'sparql_update')) {
        await Promise.all([conn.refreshGraphs(), loadClasses(), refreshSelected()]);
      }
    } catch (e) {
      push({ role: 'assistant', content: `⚠ ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  if (available === false) {
    return (
      <div className="placeholder">
        Agent unavailable — set <code>ANTHROPIC_API_KEY</code> in the studio-server environment and restart it
        (<code>pm2 restart studio-server --update-env</code>).
      </div>
    );
  }

  return (
    <div className="agent-panel">
      <div className="agent-messages">
        {messages.length === 0 && (
          <div className="placeholder">
            Ask for modeling help — e.g. “create a Venue class with name, city and capacity, shaped”, “link Album to
            Venue with a recordedAt property”, “review my shapes for gaps”.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`agent-msg ${m.role}`}>
            {m.trace && m.trace.length > 0 && (
              <div className="agent-trace">
                {m.trace.map((t, j) => (
                  <span key={j} className={`trace-chip ${t.ok ? '' : 'err'}`} title={t.input}>
                    {t.tool === 'sparql_update' ? '✎' : '🔍'} {t.tool}
                  </span>
                ))}
              </div>
            )}
            <div className="agent-text">{m.content}</div>
          </div>
        ))}
        {busy && <div className="tree-loading">thinking / querying the graph…</div>}
        <div ref={bottomRef} />
      </div>
      <div className="agent-input-row">
        <textarea
          className="agent-input"
          placeholder={conn.status === 'connected' ? 'Describe the model change…' : 'Connect to an endpoint first'}
          value={input}
          disabled={conn.status !== 'connected' || busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="agent-buttons">
          <button onClick={send} disabled={busy || !input.trim() || conn.status !== 'connected'}>
            Send
          </button>
          <button className="ghost" onClick={clear} disabled={messages.length === 0}>
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
