// SQLite files via node:sqlite (read-only).
import { DatabaseSync } from 'node:sqlite';

export const meta = { kind: 'sqlite', label: 'SQLite file', targetKind: 'file' };

export function create(id, path) {
  const db = new DatabaseSync(path, { readOnly: true });
  const tableNames = () =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  return {
    id,
    kind: 'sqlite',
    target: path,
    async tables() {
      return tableNames();
    },
    async introspect() {
      return tableNames().map((name) => {
        const columns = db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => ({
          name: c.name, type: String(c.type || 'TEXT').toUpperCase(), notnull: !!c.notnull, pk: !!c.pk,
        }));
        const fks = db.prepare(`PRAGMA foreign_key_list("${name}")`).all().map((f) => ({ from: f.from, table: f.table, to: f.to }));
        let rowCount = 0;
        try { rowCount = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n; } catch { /* virtual */ }
        return { name, rowCount, columns, fks };
      });
    },
    async page(table, limit, offset) {
      return db.prepare(`SELECT rowid AS __rowid, * FROM "${table}" LIMIT ${limit} OFFSET ${offset}`).all();
    },
    async query(sql) {
      return db.prepare(sql).all();
    },
    close() {
      try { db.close(); } catch { /* already closed */ }
    },
  };
}
