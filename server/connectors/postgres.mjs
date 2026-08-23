// PostgreSQL over a connection URL.
import pg from 'pg';

export const meta = { kind: 'postgres', label: 'PostgreSQL URL', targetKind: 'url' };

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

export function create(id, url) {
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
