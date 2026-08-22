// Read-query cache with write invalidation — the studio's caching tier.
// All SPARQL reads route through the server (see /db passthrough); any write
// (SPARQL update, graph-store load, materialization, agent update) clears it.
// LRU + TTL. Honest scope: one in-memory tier, correct invalidation.

export class QueryCache {
  constructor({ maxEntries = 500, ttlMs = 60_000 } = {}) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    /** @type {Map<string, {at: number, status: number, contentType: string, body: string}>} */
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
    this.invalidations = 0;
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

  set(url, body, entry) {
    const k = this.key(url, body);
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(k, { ...entry, at: Date.now() });
  }

  invalidate() {
    if (this.map.size > 0) this.invalidations++;
    this.map.clear();
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      entries: this.map.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? +(this.hits / total).toFixed(3) : 0,
      invalidations: this.invalidations,
      ttlMs: this.ttlMs,
    };
  }
}
