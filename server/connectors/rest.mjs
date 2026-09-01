// REST/JSON API as a virtual source (Ephedra-style hybrid federation).
// Target (JSON): {
//   baseUrl: "https://api.example.com",
//   headers?: { Authorization: "Bearer …" },
//   cacheTtlMs?: 30000,
//   allowPrivateHost?: true,  // opt past the SSRF guard for internal/on-prem APIs
//                             // (default: private/loopback/metadata hosts blocked)
//   resources: [{ name: "users", path: "/users", method?: "GET", rowsPath?: "data.items", params?: {…} }]
// }
// Each resource becomes a "table"; rows come from the JSON response (rowsPath
// walks to the array). The federation layer only ever issues the guarded
// SELECT it builds itself, so query(sql) parses that closed grammar and
// evaluates it in memory over the fetched rows.

import { assertPublicUrl } from '../core/net.mjs';

export const meta = { kind: 'rest', label: 'REST / JSON API (experimental)', targetKind: 'json' };

const walkPath = (obj, path) =>
  !path ? obj : path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

/** Flatten a JSON row to scalar columns; nested objects/arrays stringify. */
function toRow(item) {
  const row = {};
  for (const [k, v] of Object.entries(item ?? {})) {
    row[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
  }
  return row;
}

// ---- evaluator for the federation's own SELECT grammar ----

const unq = (s) => s.replace(/^"|"$/g, '');

function parseLit(text) {
  if (/^'/.test(text)) return text.slice(1, -1).replace(/''/g, "'");
  const n = Number(text);
  if (!Number.isNaN(n)) return n;
  return text;
}

export function parseGuardedSelect(sql) {
  const m =
    /^SELECT\s+(?<cols>.+?)\s+FROM\s+(?<table>"[^"]+")(?:\s+WHERE\s+(?<where>.+?))?(?:\s+ORDER BY\s+(?<ocol>"[^"]+")\s+(?<odir>ASC|DESC))?\s+LIMIT\s+(?<limit>\d+)(?:\s+OFFSET\s+(?<offset>\d+))?\s*$/is.exec(
      sql
    );
  if (!m) throw new Error(`rest connector: unsupported SQL shape: ${sql.slice(0, 120)}`);
  const g = m.groups;
  const filters = [];
  if (g.where) {
    for (const clause of g.where.split(/\s+AND\s+/i)) {
      const like = /^LOWER\("(?<col>[^"]+)"\)\s+LIKE\s+(?<lit>'.*')$/is.exec(clause.trim());
      if (like) {
        filters.push({ column: like.groups.col, op: 'ILIKE', value: parseLit(like.groups.lit) });
        continue;
      }
      const cmp = /^"(?<col>[^"]+)"\s+(?<op>!?=|<>|>=|<=|>|<)\s+(?<lit>.+)$/s.exec(clause.trim());
      if (!cmp) throw new Error(`rest connector: unsupported WHERE clause: ${clause}`);
      filters.push({ column: cmp.groups.col, op: cmp.groups.op, value: parseLit(cmp.groups.lit.trim()) });
    }
  }
  return {
    columns: g.cols.split(',').map((c) => unq(c.trim())),
    table: unq(g.table),
    filters,
    orderBy: g.ocol ? { column: unq(g.ocol), dir: (g.odir ?? 'ASC').toUpperCase() } : null,
    limit: Number(g.limit),
    offset: g.offset ? Number(g.offset) : 0,
  };
}

function cmp(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function matches(row, f) {
  const v = row[f.column];
  switch (f.op) {
    case 'ILIKE': {
      const pat = String(f.value).toLowerCase();
      const needle = pat.replace(/^%|%$/g, '');
      const hay = String(v ?? '').toLowerCase();
      if (pat.startsWith('%') && pat.endsWith('%')) return hay.includes(needle);
      if (pat.endsWith('%')) return hay.startsWith(needle);
      if (pat.startsWith('%')) return hay.endsWith(needle);
      return hay === needle;
    }
    case '=': return cmp(v, f.value) === 0;
    case '!=':
    case '<>': return cmp(v, f.value) !== 0;
    case '>': return cmp(v, f.value) > 0;
    case '<': return cmp(v, f.value) < 0;
    case '>=': return cmp(v, f.value) >= 0;
    case '<=': return cmp(v, f.value) <= 0;
    default: throw new Error(`rest connector: operator ${f.op}`);
  }
}

export function create(id, target) {
  const cfg = typeof target === 'string' ? JSON.parse(target) : target;
  if (!cfg?.baseUrl || !Array.isArray(cfg.resources) || cfg.resources.length === 0) {
    throw new Error("rest connector needs { baseUrl, resources: [{ name, path }] }");
  }
  const ttl = Number(cfg.cacheTtlMs) > 0 ? Number(cfg.cacheTtlMs) : 30_000;
  const byName = new Map(cfg.resources.map((r) => [r.name, r]));
  const cache = new Map(); // name → { at, rows }

  async function fetchRows(name) {
    const res = byName.get(name);
    if (!res) throw new Error(`rest connector: unknown resource '${name}'`);
    const hit = cache.get(name);
    if (hit && Date.now() - hit.at < ttl) return hit.rows;
    const url = new URL(res.path, cfg.baseUrl);
    for (const [k, v] of Object.entries(res.params ?? {})) url.searchParams.set(k, String(v));
    // SECURITY (SSRF): baseUrl/path are user-supplied connector config — reject
    // private/loopback/metadata targets before fetching. An operator who
    // deliberately points at an internal API opts in with allowPrivateHost.
    await assertPublicUrl(url.href, { allowPrivate: cfg.allowPrivateHost === true });
    const r = await fetch(url, { method: res.method ?? 'GET', headers: cfg.headers ?? {} });
    if (!r.ok) throw new Error(`rest connector: ${name} → HTTP ${r.status}`);
    const body = await r.json();
    const arr = walkPath(body, res.rowsPath ?? '');
    if (!Array.isArray(arr)) throw new Error(`rest connector: rowsPath '${res.rowsPath ?? ''}' of ${name} is not an array`);
    const rows = arr.map(toRow);
    cache.set(name, { at: Date.now(), rows });
    return rows;
  }

  return {
    id,
    kind: 'rest',
    target: JSON.stringify({ ...cfg, headers: cfg.headers ? '***' : undefined }),
    async tables() {
      return [...byName.keys()];
    },
    async introspect() {
      const out = [];
      for (const name of byName.keys()) {
        let rows = [];
        try {
          rows = await fetchRows(name);
        } catch { /* unreachable resource still lists, with no columns */ }
        const cols = new Map();
        for (const row of rows.slice(0, 50)) {
          for (const [k, v] of Object.entries(row)) {
            if (!cols.has(k)) cols.set(k, typeof v === 'number' ? 'NUMERIC' : 'TEXT');
          }
        }
        out.push({
          name,
          rowCount: rows.length,
          columns: [...cols.entries()].map(([n, type]) => ({ name: n, type, notnull: false, pk: false })),
          fks: [],
        });
      }
      return out;
    },
    async page(table, limit, offset) {
      const rows = await fetchRows(table);
      return rows.slice(offset, offset + limit).map((r, i) => ({ __rowid: offset + i, ...r }));
    },
    async query(sql) {
      const q = parseGuardedSelect(sql);
      let rows = (await fetchRows(q.table)).filter((r) => q.filters.every((f) => matches(r, f)));
      if (q.orderBy) {
        const { column, dir } = q.orderBy;
        rows = [...rows].sort((a, b) => (dir === 'DESC' ? -1 : 1) * cmp(a[column], b[column]));
      }
      rows = rows.slice(q.offset, q.offset + q.limit);
      return rows.map((r) => Object.fromEntries(q.columns.map((c) => [c, r[c] ?? null])));
    },
    close() {
      cache.clear();
    },
  };
}
