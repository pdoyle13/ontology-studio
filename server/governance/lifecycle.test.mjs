import { describe, it, expect } from 'vitest';
import { DEFAULT_WORKFLOW, roleAllows, availableTransitions, validateTransition } from './lifecycle.mjs';

describe('roleAllows', () => {
  it('ranks viewer < editor < steward < admin', () => {
    expect(roleAllows('editor', 'editor')).toBe(true);
    expect(roleAllows('viewer', 'editor')).toBe(false);
    expect(roleAllows('admin', 'steward')).toBe(true);
    expect(roleAllows('steward', 'admin')).toBe(false);
  });
});

describe('availableTransitions', () => {
  it('null state means the initial state', () => {
    const t = availableTransitions(DEFAULT_WORKFLOW, null, 'editor');
    expect(t.map((x) => x.to)).toEqual(['in-review']);
  });

  it('stewards see approve + send-back from in-review; editors see nothing', () => {
    expect(availableTransitions(DEFAULT_WORKFLOW, 'in-review', 'steward').map((x) => x.to).sort()).toEqual(['approved', 'draft']);
    expect(availableTransitions(DEFAULT_WORKFLOW, 'in-review', 'editor')).toEqual([]);
  });
});

describe('validateTransition', () => {
  it('accepts a legal move by a sufficient role', () => {
    expect(validateTransition(DEFAULT_WORKFLOW, 'draft', 'in-review', 'editor')).toBeNull();
  });

  it('rejects undeclared moves and underpowered roles', () => {
    expect(validateTransition(DEFAULT_WORKFLOW, 'draft', 'approved', 'admin')).toMatchObject({ status: 400, error: expect.stringMatching(/no transition/) });
    expect(validateTransition(DEFAULT_WORKFLOW, 'in-review', 'approved', 'editor')).toMatchObject({ status: 403, error: expect.stringMatching(/needs steward/) });
  });

  it('custom workflows drive everything', () => {
    const wf = {
      states: ['new', 'done'],
      transitions: [{ from: 'new', to: 'done', label: 'Finish', role: 'viewer' }],
      initial: 'new',
    };
    expect(validateTransition(wf, null, 'done', 'viewer')).toBeNull();
    expect(availableTransitions(wf, 'done', 'admin')).toEqual([]);
  });
});
