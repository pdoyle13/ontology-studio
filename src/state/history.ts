// Undo/redo: every write goes through a command that records its inverse.

import { create } from 'zustand';

export interface Command {
    label: string;
    redo: () => Promise<void>;
    undo: () => Promise<void>;
}

interface HistoryState {
    undoStack: Command[];
    redoStack: Command[];
    busy: boolean;
    /** Execute a command and push it (clears the redo stack). */
    exec: (cmd: Command) => Promise<void>;
    undo: () => Promise<string | null>;
    redo: () => Promise<string | null>;
}

const MAX = 100;

export const useHistory = create<HistoryState>((set, get) => ({
    undoStack: [],
    redoStack: [],
    busy: false,

    exec: async (cmd) => {
        set({ busy: true });
        try {
            await cmd.redo();
            set({ undoStack: [...get().undoStack, cmd].slice(-MAX), redoStack: [] });
        } finally {
            set({ busy: false });
        }
    },

    undo: async () => {
        const stack = get().undoStack;
        const cmd = stack[stack.length - 1];
        if (!cmd) return null;
        set({ busy: true });
        try {
            await cmd.undo();
            set({ undoStack: stack.slice(0, -1), redoStack: [...get().redoStack, cmd] });
            return cmd.label;
        } finally {
            set({ busy: false });
        }
    },

    redo: async () => {
        const stack = get().redoStack;
        const cmd = stack[stack.length - 1];
        if (!cmd) return null;
        set({ busy: true });
        try {
            await cmd.redo();
            set({ redoStack: stack.slice(0, -1), undoStack: [...get().undoStack, cmd] });
            return cmd.label;
        } finally {
            set({ busy: false });
        }
    },
}));
