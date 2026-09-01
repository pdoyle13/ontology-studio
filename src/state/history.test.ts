import { describe, it, expect, beforeEach } from 'vitest';
import { useHistory, type Command } from './history';

const reset = () => useHistory.setState({ undoStack: [], redoStack: [], busy: false });

/** A command that records how many times each direction ran, and appends to a trace. */
function cmd(label: string, trace: string[]): Command {
    return {
        label,
        redo: async () => {
            trace.push(`redo:${label}`);
        },
        undo: async () => {
            trace.push(`undo:${label}`);
        },
    };
}

describe('useHistory', () => {
    beforeEach(reset);

    it('exec runs redo and pushes onto the undo stack, clearing redo', async () => {
        const trace: string[] = [];
        await useHistory.getState().exec(cmd('a', trace));
        expect(trace).toEqual(['redo:a']);
        expect(useHistory.getState().undoStack.map((c) => c.label)).toEqual(['a']);
        expect(useHistory.getState().redoStack).toEqual([]);
        expect(useHistory.getState().busy).toBe(false);
    });

    it('undo then redo round-trips a command between the stacks', async () => {
        const trace: string[] = [];
        await useHistory.getState().exec(cmd('a', trace));
        expect(await useHistory.getState().undo()).toBe('a');
        expect(useHistory.getState().undoStack).toEqual([]);
        expect(useHistory.getState().redoStack.map((c) => c.label)).toEqual(['a']);
        expect(await useHistory.getState().redo()).toBe('a');
        expect(useHistory.getState().undoStack.map((c) => c.label)).toEqual(['a']);
        expect(useHistory.getState().redoStack).toEqual([]);
        expect(trace).toEqual(['redo:a', 'undo:a', 'redo:a']);
    });

    it('undo/redo pops in LIFO order', async () => {
        const trace: string[] = [];
        await useHistory.getState().exec(cmd('a', trace));
        await useHistory.getState().exec(cmd('b', trace));
        expect(await useHistory.getState().undo()).toBe('b');
        expect(await useHistory.getState().undo()).toBe('a');
    });

    it('a new exec clears the redo stack (branching)', async () => {
        const trace: string[] = [];
        await useHistory.getState().exec(cmd('a', trace));
        await useHistory.getState().undo();
        expect(useHistory.getState().redoStack).toHaveLength(1);
        await useHistory.getState().exec(cmd('b', trace));
        expect(useHistory.getState().redoStack).toEqual([]);
        expect(useHistory.getState().undoStack.map((c) => c.label)).toEqual(['b']);
    });

    it('returns null when there is nothing to undo or redo', async () => {
        expect(await useHistory.getState().undo()).toBeNull();
        expect(await useHistory.getState().redo()).toBeNull();
    });

    it('caps the undo stack at 100 entries (oldest dropped)', async () => {
        const trace: string[] = [];
        for (let i = 0; i < 105; i++) await useHistory.getState().exec(cmd(`c${i}`, trace));
        const stack = useHistory.getState().undoStack;
        expect(stack).toHaveLength(100);
        expect(stack[0].label).toBe('c5'); // c0..c4 dropped
        expect(stack[99].label).toBe('c104');
    });
});
