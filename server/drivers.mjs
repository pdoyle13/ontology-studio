// SQL source drivers: one async interface over SQLite files and PostgreSQL
// connections. Introspection returns the same shape either way, so the
// translate/materialize pipeline is driver-agnostic.

import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

/** Strip credentials from a connection descriptor before it's stored/displayed. */
export function safeDescriptor(kind, target) {
  if (kind !== 'postgres') return target;
  try {
    const u = new URL(target);
    u.password = '';
    u.username = u.username ? '***' : '';
    return u.toString();
  } catch {
    return 'postgres://…';
  }
}

/** Map pg information_schema data_type to the SQL-ish type names translate.mjs expects. */
export function pgTypeName(dataType) {
  const t = String(dataType).toLowerCase();
  if (/^(smallint|integer|bigint)$/.test(t)) return 'INTEGER';
  if (/numeric|decimal|real|double/.test(t)) return 'DECIMAL';
  if (t === 'boolean') return 'BOOLEAN';
  if (/timestamp/.test(t)) return 'DATETIME';
  if (t === 'date') return 'DATE';
  if (t === 'bytea') return 'BLOB';
  return 'TEXT';
}

function sqliteDriver(id, path) {
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

function pgDriver(id, url) {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  return {
    id,
    kind: 'postgres',
    target: url,
    async tables() {
      const r = await pool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name"
      );
      return r.rows.map((x) => x.table_name);
    },
    async introspect() {
      const tables = await this.tables();
      const out = [];
      for (const name of tables) {
        const cols = await pool.query(
          "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
          [name]
        );
        const pks = await pool.query(
          `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
           WHERE i.indrelid=($1::text)::regclass AND i.indisprimary`,
          [`"${name}"`]
        );
        const pkSet = new Set(pks.rows.map((r) => r.attname));
        const fks = await pool.query(
          `SELECT kcu.column_name AS "from", ccu.table_name AS "table", ccu.column_name AS "to"
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
           JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema
           WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_name=$1 AND tc.table_schema='public'`,
          [name]
        );
        let rowCount = 0;
        try { rowCount = Number((await pool.query(`SELECT COUNT(*) AS n FROM "${name}"`)).rows[0].n); } catch { /* perms */ }
        out.push({
          name,
          rowCount,
          columns: cols.rows.map((c) => ({
            name: c.column_name,
            type: pgTypeName(c.data_type),
            notnull: c.is_nullable === 'NO',
            pk: pkSet.has(c.column_name),
          })),
          fks: fks.rows,
        });
      }
      return out;
    },
    async page(table, limit, offset) {
      const r = await pool.query(`SELECT ctid::text AS __rowid, * FROM "${table}" ORDER BY ctid LIMIT $1 OFFSET $2`, [limit, offset]);
      return r.rows;
    },
    async query(sql) {
      const r = await pool.query(sql);
      return r.rows;
    },
    close() {
      pool.end().catch(() => {});
    },
  };
}

/** Create a driver. kind: 'sqlite' (target = file path) or 'postgres' (target = connection URL). */
export function createDriver({ id, kind = 'sqlite', target }) {
  if (kind === 'postgres') return pgDriver(id, target);
  return sqliteDriver(id, target);
}
