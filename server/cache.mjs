// Enterprise caching for the semantic layer.
//   Tier 1: in-memory LRU (fastest, process-local)
//   Tier 2: persistent disk cache (survives restarts, larger, promoted to T1 on hit)
//   Plus a short-TTL federated-SQL result cache (per-source tags).
// Invalidation is TAG-SCOPED: writes evict only the graphs they touch. Entries
// tagged '*' depend on everything and are evicted on any invalidation.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';

const intersects = (a, b) => a.includes('*') || b.includes('*') || a.some((t) => b.includes(t));

export class QueryCache {
  constructor({ maxEntries = 500, ttlMs = 60_000 } = {}) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    /** @type {Map<string, {at: number, tags: string[], status: number, contentType: string, body: string}>} */
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
    this.invalidations = 0;
    this.evictions = 0;
  }

  key(url, body) {
    return `${url}\n${body}`;
  }

  get(url, body) {
    const k = this.key(url, body);
    const e = this.map.get(k);
    if (!e) {
      this.misses++;
      return null;
    }
    if (Date.now() - e.at > this.ttlMs) {
      this.map.delete(k);
      this.misses++;
      return null;
    }
    // LRU bump
    this.map.delete(k);
    this.map.set(k, e);
    this.hits++;
    return e;
  }

  set(url, body, entry, tags = ['*']) {
    const k = this.key(url, body);
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        this.map.delete(oldest);
        this.evictions++;
      }
    }
    this.map.set(k, { ...entry, tags, at: Date.now() });
  }

  /** No tags → clear everything. With tags → evict intersecting + '*' entries. */
  invalidate(tags) {
    let removed = 0;
    if (!tags || tags.length === 0) {
      removed = this.map.size;
      this.map.clear();
    } else {
      for (const [k, e] of this.map) {
        if (intersects(e.tags ?? ['*'], tags)) {
          this.map.delete(k);
          removed++;
        }
      }
    }
    if (removed > 0) this.invalidations++;
    for (const fn of this.listeners ?? []) fn(tags);
    return removed;
  }

  /** Register a callback fired on every invalidation (e.g. dependent memos). */
  onInvalidate(fn) {
    (this.listeners ??= []).push(fn);
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      entries: this.map.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? +(this.hits / total).toFixed(3) : 0,
      invalidations: this.invalidations,
      evictions: this.evictions,
      ttlMs: this.ttlMs,
    };
  }
}

export class DiskCache {
  constructor({ dir, ttlMs = 600_000, maxEntries = 2000 } = {}) {
    this.dir = dir;
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.hits = 0;
    this.misses = 0;
    this.invalidations = 0;
    mkdirSync(dir, { recursive: true });
  }

  file(url, body) {
    return join(this.dir, `${createHash('sha256').update(`${url}\n${body}`).digest('hex')}.json`);
  }

  get(url, body) {
    try {
      const e = JSON.parse(readFileSync(this.file(url, body), 'utf8'));
      if (Date.now() - e.at > this.ttlMs) {
        try { unlinkSync(this.file(url, body)); } catch { /* raced */ }
        this.misses++;
        return null;
      }
      this.hits++;
      return e;
    } catch {
      this.misses++;
      return null;
    }
  }

  set(url, body, entry, tags = ['*']) {
    try {
      writeFileSync(this.file(url, body), JSON.stringify({ ...entry, tags, at: Date.now() }));
      // occasional size enforcement (cheap amortized)
      if (Math.random() < 0.02) this.enforceCap();
    } catch { /* disk cache is best-effort */ }
  }

  enforceCap() {
    try {
      const files = readdirSync(this.dir).filter((f) => f.endsWith('.json'));
      if (files.length <= this.maxEntries) return;
      const dated = files
        .map((f) => ({ f, t: statSync(join(this.dir, f)).mtimeMs }))
        .sort((a, b) => a.t - b.t);
      for (const { f } of dated.slice(0, files.length - this.maxEntries)) unlinkSync(join(this.dir, f));
    } catch { /* best-effort */ }
  }

  invalidate(tags) {
    let removed = 0;
    try {
      for (const f of readdirSync(this.dir)) {
        if (!f.endsWith('.json')) continue;
        const p = join(this.dir, f);
        if (!tags || tags.length === 0) {
          unlinkSync(p);
          removed++;
          continue;
        }
        try {
          const e = JSON.parse(readFileSync(p, 'utf8'));
          if (intersects(e.tags ?? ['*'], tags)) {
            unlinkSync(p);
            removed++;
          }
        } catch {
          unlinkSync(p); // unreadable entry — drop it
          removed++;
        }
      }
    } catch { /* best-effort */ }
    if (removed > 0) this.invalidations++;
    return removed;
  }

  stats() {
    let entries = 0;
    let bytes = 0;
    try {
      for (const f of readdirSync(this.dir)) {
        if (!f.endsWith('.json')) continue;
        entries++;
        bytes += statSync(join(this.dir, f)).size;
      }
    } catch { /* best-effort */ }
    const total = this.hits + this.misses;
    return { entries, bytes, hits: this.hits, misses: this.misses, hitRate: total ? +(this.hits / total).toFixed(3) : 0, invalidations: this.invalidations, ttlMs: this.ttlMs };
  }
}

/** Memory-over-disk: T1 hit ('mem'), else T2 hit promotes to T1 ('disk'), else null. */
export class TieredCache {
  constructor({ memory, disk }) {
    this.memory = memory;
    this.disk = disk;
  }

  get(url, body) {
    const m = this.memory.get(url, body);
    if (m) return { entry: m, tier: 'mem' };
    if (!this.disk) return null;
    const d = this.disk.get(url, body);
    if (d) {
      this.memory.set(url, body, { status: d.status, contentType: d.contentType, body: d.body }, d.tags);
      return { entry: d, tier: 'disk' };
    }
    return null;
  }

  set(url, body, entry, tags) {
    this.memory.set(url, body, entry, tags);
    this.disk?.set(url, body, entry, tags);
  }

  invalidate(tags) {
    const m = this.memory.invalidate(tags);
    const d = this.disk?.invalidate(tags) ?? 0;
    return m + d;
  }

  onInvalidate(fn) {
    this.memory.onInvalidate(fn);
  }

  stats() {
    return { memory: this.memory.stats(), disk: this.disk?.stats() ?? null };
  }
}
