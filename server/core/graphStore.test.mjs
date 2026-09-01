import { describe, it, expect } from 'vitest';
import { createGraphStore, chunkInserts, knownStoreKinds } from './graphStore.mjs';

describe('adapters: URL layouts', () => {
    it('oxigraph: /query with union param, /update, /store GSP', () => {
        const s = createGraphStore({ kind: 'oxigraph', url: 'http://ox:7878' });
        expect(s.queryUrl(true).toString()).toBe('http://ox:7878/query?union-default-graph=');
        expect(s.queryUrl(false).toString()).toBe('http://ox:7878/query');
        expect(s.updateUrl().toString()).toBe('http://ox:7878/update');
        expect(s.gspUrl('https://g/1').toString()).toContain('/store?graph=https%3A%2F%2Fg%2F1');
        expect(s.supportsGsp).toBe(true);
    });

    it('graphdb: repository endpoint, /statements updates, rdf-graphs GSP, union no-op', () => {
        const s = createGraphStore({ kind: 'graphdb', url: 'http://gdb:7200/repositories/studio' });
        expect(s.queryUrl(true).toString()).toBe('http://gdb:7200/repositories/studio');
        expect(s.updateUrl().toString()).toBe('http://gdb:7200/repositories/studio/statements');
        expect(s.gspUrl(null).toString()).toContain('/rdf-graphs/service');
    });

    it('stardog: /query with context:all union, /update, no GSP', () => {
        const s = createGraphStore({ kind: 'stardog', url: 'http://sd:5820/studio' });
        expect(s.queryUrl(true).toString()).toContain('default-graph-uri=tag%3Astardog%3Aapi%3Acontext%3Aall');
        expect(s.updateUrl().toString()).toBe('http://sd:5820/studio/update');
        expect(s.supportsGsp).toBe(false);
        expect(s.gspUrl).toBeNull();
    });

    it('neptune: single /sparql for query and update, no GSP', () => {
        const s = createGraphStore({ kind: 'neptune', url: 'https://np:8182' });
        expect(s.queryUrl(true).toString()).toBe('https://np:8182/sparql');
        expect(s.updateUrl().toString()).toBe('https://np:8182/sparql');
        expect(s.supportsGsp).toBe(false);
    });

    it('rejects unknown kinds, lists known ones', () => {
        expect(() => createGraphStore({ kind: 'virtuoso', url: 'http://x' })).toThrow(/unknown graph store kind/);
        expect(knownStoreKinds()).toEqual(['oxigraph', 'graphdb', 'stardog', 'neptune']);
    });
});

describe('auth', () => {
    it('basic auth header only when a user is configured', () => {
        const anon = createGraphStore({ kind: 'oxigraph', url: 'http://x', user: undefined });
        expect(anon.authHeaders()).toEqual({});
        const auth = createGraphStore({ kind: 'stardog', url: 'http://x', user: 'admin', password: 'pw' });
        expect(auth.authHeaders().Authorization).toBe(`Basic ${Buffer.from('admin:pw').toString('base64')}`);
    });
});

describe('chunkInserts (GSP fallback)', () => {
    it('wraps lines in graph-scoped INSERT DATA chunks', () => {
        const lines = Array.from({ length: 4500 }, (_, i) => `<s:${i}> <p> "v" .`);
        const chunks = chunkInserts(lines, 'https://g/x', 2000);
        expect(chunks).toHaveLength(3);
        expect(chunks[0]).toContain('GRAPH <https://g/x>');
        expect(chunks[2]).toContain('<s:4499>');
    });

    it('default graph without wrapper', () => {
        expect(chunkInserts(['<a> <b> <c> .'], null)[0]).toBe('INSERT DATA { <a> <b> <c> . }');
    });
});
