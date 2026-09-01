import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryCache } from './cache.mjs';

const entry = (body) => ({ status: 200, contentType: 'application/json', body });

describe('QueryCache', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('misses cold, hits warm, keyed by url+body', () => {
        const c = new QueryCache();
        expect(c.get('u', 'q1')).toBeNull();
        c.set('u', 'q1', entry('r1'));
        expect(c.get('u', 'q1')?.body).toBe('r1');
        expect(c.get('u', 'q2')).toBeNull();
        expect(c.get('u2', 'q1')).toBeNull();
    });

    it('expires entries after the TTL', () => {
        const c = new QueryCache({ ttlMs: 1000 });
        c.set('u', 'q', entry('r'));
        vi.advanceTimersByTime(999);
        expect(c.get('u', 'q')).not.toBeNull();
        vi.advanceTimersByTime(2);
        expect(c.get('u', 'q')).toBeNull();
    });

    it('evicts the least-recently-used entry at capacity', () => {
        const c = new QueryCache({ maxEntries: 2 });
        c.set('u', 'a', entry('A'));
        c.set('u', 'b', entry('B'));
        c.get('u', 'a'); // bump a
        c.set('u', 'c', entry('C')); // evicts b
        expect(c.get('u', 'a')).not.toBeNull();
        expect(c.get('u', 'b')).toBeNull();
        expect(c.get('u', 'c')).not.toBeNull();
    });

    it('invalidate clears everything and counts', () => {
        const c = new QueryCache();
        c.set('u', 'a', entry('A'));
        c.invalidate();
        expect(c.get('u', 'a')).toBeNull();
        expect(c.stats().invalidations).toBe(1);
        c.invalidate(); // empty — not counted
        expect(c.stats().invalidations).toBe(1);
    });

    it('tracks hit rate', () => {
        const c = new QueryCache();
        c.set('u', 'a', entry('A'));
        c.get('u', 'a');
        c.get('u', 'a');
        c.get('u', 'nope');
        const s = c.stats();
        expect(s.hits).toBe(2);
        expect(s.misses).toBe(1);
        expect(s.hitRate).toBeCloseTo(0.667, 2);
    });
});
