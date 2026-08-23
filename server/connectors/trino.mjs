// Trino / Presto over the REST statement protocol — zero dependencies.
// Target: http://user@host:8080/catalog/schema (user in the URL becomes
// X-Trino-User). EXPERIMENTAL: written to the documented protocol; needs a
// live cluster for validation.

export const meta = { kind: 'trino', label: 'Trino / Presto URL', targetKind: 'url', experimental: true };

const trType = (t) => {
  const u = String(t).toUpperCase();
  if (/INT/.test(u)) return 'INTEGER';
  if (/DECIMAL|DOUBLE|REAL/.test(u)) return 'DECIMAL';
  if (u === 'BOOLEAN') return 'BOOLEAN';
  if (/TIMESTAMP/.test(u)) return 'DATETIME';
  if (u === 'DATE') return 'DATE';
  if (/VARBINARY/.test(u)) return 'BLOB';
  return 'TEXT';
};

export function create(id, url) {
  const u = new URL(url);
  const [catalog, schema] = u.pathname.replace(/^\//, '').split('/');
  const base = `${u.protocol}//${u.host}`;
  const userName = decodeURIComponent(u.username || 'studio');
  const headers = {
    'X-Trino-User': userName,
    'X-Trino-Catalog': catalog ?? 'system',
    'X-Trino-Schema': schema ?? 'default',
  };

  // POST the statement, then follow nextUri until the result set completes
  const run = async (sql) => {
    let res = await fetch(`${base}/v1/statement`, { method: 'POST', headers, body: sql });
    const columns = [];
    const rows = [];
    for (;;) {
      if (!res.ok) throw new Error(`trino ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      if (json.columns && columns.length === 0) columns.push(...json.columns.map((c) => c.name));
      for (const r of json.data ?? []) rows.push(Object.fromEntries(columns.map((c, i) => [c, r[i]])));
      if (!json.nextUri) break;
      res = await fetch(json.nextUri, { headers });
    }
    return rows;
  };

  const esc = (v) => `'${String(v).replace(/'/g, "''")}'`;
  return {
    id,
    kind: 'trino',
    target: url,
    async tables() {
      const rows = await run(`SELECT table_name FROM information_schema.tables WHERE table_schema=${esc(schema ?? 'default')} ORDER BY table_name`);
      return rows.map((r) => r.table_name);
    },
    async introspect() {
      const names = await this.tables();
      const out = [];
      for (const name of names) {
        const cols = await run(
          `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema=${esc(schema ?? 'default')} AND table_name=${esc(name)} ORDER BY ordinal_position`
        );
        let rowCount = 0;
        try {
          rowCount = Number((await run(`SELECT COUNT(*) AS n FROM "${name}"`))[0].n);
        } catch {
          /* perms */
        }
        out.push({
          name,
          rowCount,
          columns: cols.map((c) => ({
            name: c.column_name,
            type: trType(c.data_type),
            notnull: c.is_nullable === 'NO',
            pk: false, // Trino exposes no PK metadata; declare keys in-studio
          })),
          fks: [],
        });
      }
      return out;
    },
    async page(table, limit, offset) {
      return run(`SELECT * FROM "${table}" OFFSET ${Number(offset)} LIMIT ${Number(limit)}`);
    },
    async query(sql) {
      return run(sql);
    },
    close() {
      /* stateless */
    },
  };
}
