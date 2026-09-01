import { describe, it, expect } from 'vitest';
import { canWriteDirect, canPropose, canReview } from './governance.mjs';

const G1 = 'https://studio.local/graphs/lineage';
const G2 = 'https://studio.local/graphs/other';

const admin = { name: 'pat', role: 'admin', governs: [] };
const steward = { name: 'sam', role: 'steward', governs: [G1] };
const editor = { name: 'quinn', role: 'editor', governs: [] };
const viewer = { name: 'anon', role: 'viewer', governs: [] };

describe('canWriteDirect', () => {
    it('admin writes anywhere, including the default graph', () => {
        expect(canWriteDirect(admin, [G1])).toBe(true);
        expect(canWriteDirect(admin, [])).toBe(true);
    });

    it('steward writes only within governed graphs', () => {
        expect(canWriteDirect(steward, [G1])).toBe(true);
        expect(canWriteDirect(steward, [G2])).toBe(false);
        expect(canWriteDirect(steward, [G1, G2])).toBe(false); // every target must be governed
        expect(canWriteDirect(steward, [])).toBe(false); // default-graph writes need admin
    });

    it('editors and viewers never write directly', () => {
        expect(canWriteDirect(editor, [G1])).toBe(false);
        expect(canWriteDirect(viewer, [G1])).toBe(false);
    });
});

describe('canPropose', () => {
    it('everyone but viewers may propose', () => {
        expect(canPropose(admin)).toBe(true);
        expect(canPropose(steward)).toBe(true);
        expect(canPropose(editor)).toBe(true);
        expect(canPropose(viewer)).toBe(false);
    });
});

describe('canReview', () => {
    it('admin reviews anything; steward only their governed graphs', () => {
        expect(canReview(admin, G2)).toBe(true);
        expect(canReview(steward, G1)).toBe(true);
        expect(canReview(steward, G2)).toBe(false);
        expect(canReview(editor, G1)).toBe(false);
        expect(canReview(viewer, G1)).toBe(false);
    });
});
