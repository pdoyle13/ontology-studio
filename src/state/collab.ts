// Collaboration: a WebSocket to the studio server. Remote writes arrive as
// graph-changed events (with the invalidated graph tags) → this client
// refreshes its view of the world. Presence keeps a live participant count.

import { create } from 'zustand';
import { useConnection } from './connection';
import { useGraph } from './graph';
import { invalidateVirtualMemo } from '../rdf/virtualApi';

export interface Toast {
    id: number;
    text: string;
    iri?: string;
}

interface CollabState {
    peers: number;
    connected: boolean;
    lastEvent: string | null;
    toasts: Toast[];
}

export const useCollab = create<CollabState>(() => ({
    peers: 0,
    connected: false,
    lastEvent: null,
    toasts: [],
}));

let toastSeq = 0;
export function pushToast(text: string, iri?: string) {
    const id = ++toastSeq;
    useCollab.setState((s) => ({ toasts: [...s.toasts, { id, text, iri }].slice(-4) }));
    setTimeout(() => useCollab.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 9000);
}

let socket: WebSocket | null = null;
let retryMs = 1000;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced full refresh — bursts of remote writes collapse to one reload. */
function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
        refreshTimer = null;
        invalidateVirtualMemo();
        const conn = useConnection.getState();
        if (conn.status !== 'connected') return;
        await Promise.all([
            conn.refreshGraphs(),
            useGraph.getState().loadClasses(),
            useGraph.getState().refreshSelected(),
        ]);
    }, 500);
}

function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    try {
        socket = new WebSocket(`${proto}://${location.host}/ws`);
    } catch {
        return;
    }
    socket.onopen = () => {
        retryMs = 1000;
        useCollab.setState({ connected: true });
    };
    socket.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            useCollab.setState({ lastEvent: msg.type });
            if (msg.type === 'presence') useCollab.setState({ peers: msg.count });
            else if (msg.type === 'graph-changed') scheduleRefresh();
            else if (msg.type === 'search-watch') {
                const first = msg.newHits?.[0];
                pushToast(
                    `Watch “${msg.query}”: ${msg.newHits?.length ?? 0} new result(s)` +
                        (first?.label ? ` — ${first.label}` : ''),
                    first?.iri,
                );
            }
        } catch {
            /* ignore */
        }
    };
    socket.onclose = () => {
        // keep the last peer count through the reconnect — zeroing it here made
        // the "N online" badge flash 0 on every transient drop
        useCollab.setState({ connected: false });
        setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 15000);
    };
}

export function startCollab() {
    if (socket) return;
    connect();
}

/** Optional: tell peers what this client selected (presence-lite). */
export function broadcastSelection(iri: string) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'selection', iri }));
}
