// API token store tests (remediation coverage). Security-relevant: bearer
// verify, hash-only storage, revoke, and persistence across instances.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTokenStore } from './tokens.mjs';

let path;
function freshPath() {
    path = join(tmpdir(), `ostudio-tokens-test-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    return path;
}
afterEach(() => {
    if (path && existsSync(path)) rmSync(path, { force: true });
});

describe('createTokenStore', () => {
    it('issues a prefixed token and verifies it back to the user', () => {
        const store = createTokenStore(freshPath());
        const { id, token } = store.create('ada', 'ci');
        expect(token).toMatch(/^ostudio_[0-9a-f]{48}$/);
        expect(id).toBeTruthy();
        expect(store.verify(token)).toBe('ada');
    });

    it('returns null for an unknown or empty token', () => {
        const store = createTokenStore(freshPath());
        store.create('ada');
        expect(store.verify('ostudio_deadbeef')).toBeNull();
        expect(store.verify('')).toBeNull();
        expect(store.verify(undefined)).toBeNull();
    });

    it('persists only the hash, never the plaintext', () => {
        const store = createTokenStore(freshPath());
        const { token } = store.create('ada');
        const onDisk = readFileSync(path, 'utf8');
        expect(onDisk).not.toContain(token);
        expect(onDisk).toContain('hash');
    });

    it('list() hides the hash', () => {
        const store = createTokenStore(freshPath());
        store.create('ada', 'laptop');
        const [row] = store.list();
        expect(row).toMatchObject({ user: 'ada', label: 'laptop' });
        expect(row.hash).toBeUndefined();
    });

    it('revoke removes the token and reports whether it existed', () => {
        const store = createTokenStore(freshPath());
        const { id, token } = store.create('ada');
        expect(store.revoke(id)).toBe(true);
        expect(store.verify(token)).toBeNull();
        expect(store.revoke('nope')).toBe(false);
    });

    it('persists across store instances on the same file', () => {
        const p = freshPath();
        const { token } = createTokenStore(p).create('brin');
        // a fresh store reading the same file still verifies the token
        expect(createTokenStore(p).verify(token)).toBe('brin');
    });

    it('starts empty when the file is missing or corrupt', () => {
        const store = createTokenStore(join(tmpdir(), `ostudio-missing-${Math.random().toString(36).slice(2)}.json`));
        expect(store.list()).toEqual([]);
        expect(store.verify('whatever')).toBeNull();
    });
});
