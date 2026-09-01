// Modeling copilot chat: talks to the studio-server agent loop (Claude + SPARQL
// tools). After each reply the UI refreshes — the agent writes to the store.

import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useConnection } from '../state/connection';
import { useUi } from '../state/ui';
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

/** Intent chips — the "what do you want to do" front door. `send` chips run
 *  immediately; `fill` chips prefill the input for the user to complete;
 *  `dialog` opens the import/export dialog (client-side file operations). */
const INTENTS: { label: string; kind: 'send' | 'fill' | 'dialog'; text?: string }[] = [
    {
        label: '🔌 Add a datasource',
        kind: 'fill',
        text: 'Attach this database and translate its schema into the graph: ',
    },
    {
        label: '❓ Ask a question',
        kind: 'fill',
        text: 'Across all our databases, ',
    },
    {
        label: '🔍 Query data',
        kind: 'send',
        text: 'List the available data classes with their owning databases and row counts, then suggest three example cross-database questions I could ask.',
    },
    {
        label: '🧭 Discover business areas',
        kind: 'send',
        text: 'Run business-area discovery, then summarize which FIBO business areas each database covers.',
    },
    {
        label: '🧩 Model something',
        kind: 'fill',
        text: 'Create a class (with a SHACL shape) for ',
    },
    {
        label: '🔗 Connect databases',
        kind: 'fill',
        text: 'Declare a field-level link: ',
    },
    { label: '📥 Import RDF', kind: 'dialog' },
    { label: '📤 Export data', kind: 'dialog' },
];

export function AgentPanel() {
    const conn = useConnection();
    const { loadClasses, refreshSelected } = useGraph();
    const { messages, busy, push, setBusy, clear } = useAgent();
    const setImportExportOpen = useUi((s) => s.setImportExportOpen);
    const [input, setInput] = useState('');
    const [available, setAvailable] = useState<boolean | null>(null);
    const [proposeMode, setProposeMode] = useState(false);
    const [proposalId, setProposalId] = useState<string | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        fetch('/api/health')
            .then((r) => r.json())
            .then((h) => setAvailable(!!h.agent))
            .catch(() => setAvailable(false));
    }, []);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, busy]);

    const runIntent = (intent: (typeof INTENTS)[number]) => {
        if (intent.kind === 'dialog') {
            setImportExportOpen(true);
            return;
        }
        if (intent.kind === 'send' && intent.text) {
            sendText(intent.text);
            return;
        }
        setInput(intent.text ?? '');
        inputRef.current?.focus();
    };

    const send = async () => sendText(input.trim());

    const sendText = async (text: string) => {
        if (!text || busy) return;
        setInput('');
        push({ role: 'user', content: text });
        setBusy(true);
        try {
            const history = [...useAgent.getState().messages].map((m) => ({ role: m.role, content: m.content }));
            let prop = proposalId;
            if (proposeMode && !prop) {
                const pr = await fetch('/api/proposals', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: text.slice(0, 60), targetGraph: conn.activeGraph }),
                });
                const pj = await pr.json();
                if (!pr.ok) throw new Error(pj.error ?? 'could not create proposal');
                prop = pj.id;
                setProposalId(pj.id);
            }
            const res = await fetch('/api/agent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: history, graph: conn.activeGraph, proposal: prop ?? undefined }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error ?? `${res.status}`);
            push({ role: 'assistant', content: json.reply, trace: json.trace });
            const writeTools = [
                'sparql_update',
                'create_class',
                'create_property',
                'create_node_shape',
                'create_instance',
                'set_property_value',
                'remove_property_value',
                'link_resources',
                'declare_link',
                'delete_resource',
                'add_sql_source',
                'translate_source',
                'discover_business_areas',
            ];
            if (json.trace?.some((t: { tool: string }) => writeTools.includes(t.tool))) {
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
                Agent unavailable — set <code>GROK_API_KEY</code> (or <code>ANTHROPIC_API_KEY</code>) in the studio
                server's <code>.env</code> and restart it.
            </div>
        );
    }

    return (
        <div className="agent-panel">
            <div className="agent-messages">
                {messages.length === 0 && (
                    <div className="agent-welcome">
                        <div className="welcome-title">What do you want to do?</div>
                        <div className="intent-chips">
                            {INTENTS.map((intent) => (
                                <button key={intent.label} className="intent-chip" onClick={() => runIntent(intent)}>
                                    {intent.label}
                                </button>
                            ))}
                        </div>
                        <div className="term-meta" style={{ marginTop: 10 }}>
                            …or just describe it. The agent models the graph, connects databases at the field level, and
                            answers questions from live source data.
                        </div>
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
                    ref={inputRef}
                    className="agent-input"
                    placeholder={
                        conn.status === 'connected' ? 'Describe the model change…' : 'Connect to an endpoint first'
                    }
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
                    <label
                        className="term-meta"
                        style={{ marginRight: 'auto' }}
                        title="Agent writes are staged into a proposal for review instead of applied directly"
                    >
                        <input
                            type="checkbox"
                            checked={proposeMode}
                            onChange={(e) => {
                                setProposeMode(e.target.checked);
                                if (!e.target.checked) setProposalId(null);
                            }}
                        />{' '}
                        propose{proposalId ? ` (${proposalId})` : ''}
                    </label>
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
