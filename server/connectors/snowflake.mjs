// Snowflake warehouse. Target is a JSON descriptor:
//   {"account":"xy12345.us-east-1","username":"u","password":"p","database":"DB","schema":"PUBLIC","warehouse":"WH"}
// The snowflake-sdk dependency loads lazily — absence only breaks this kind.
// EXPERIMENTAL: written to the documented SDK surface, not yet validated
// against a live account.

import { parseJsonSafe, stripProto } from '../core/json.mjs';

export const meta = { kind: 'snowflake', label: 'Snowflake (JSON descriptor)', targetKind: 'json', experimental: true };

const sfType = (t) => {
  const u = String(t).toUpperCase();
  if (/NUMBER\(\d+,0\)|^INT|BIGINT|SMALLINT/.test(u)) return 'INTEGER';
  if (/NUMBER|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL/.test(u)) return 'DECIMAL';
  if (/BOOL/.test(u)) return 'BOOLEAN';
  if (/TIMESTAMP/.test(u)) return 'DATETIME';
  if (u === 'DATE') return 'DATE';
  if (/BINARY/.test(u)) return 'BLOB';
  return 'TEXT';
};

export function create(id, target) {
  const cfg = typeof target === 'string' ? parseJsonSafe(target) : stripProto(target);
  let connPromise = null;
  const connect = () => {
    if (!connPromise) {
      connPromise = import('snowflake-sdk').then(
        (sf) =>
          new Promise((resolve, reject) => {
            const conn = sf.default.createConnection(cfg);
            conn.connect((err, c) => (err ? reject(err) : resolve(c)));
          })
      );
    }
    return connPromise;
  };
  const run = async (sqlText, binds = []) => {
    const conn = await connect();
    return new Promise((resolve, reject) => {
      conn.execute({ sqlText, binds, complete: (err, _stmt, rows) => (err ? reject(err) : resolve(rows ?? [])) });
    });
  };
  const schema = (cfg.schema ?? 'PUBLIC').toUpperCase();
  return {
    id,
    kind: 'snowflake',
    target: JSON.stringify({ ...cfg, password: undefined, token: undefined }),
    async tables() {
      const rows = await run(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='${schema}' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`
      );
      return rows.map((r) => r.TABLE_NAME);
    },
    async introspect() {
      const names = await this.tables();
      const out = [];
      for (const name of names) {
        const cols = await run(
          `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='${schema}' AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`,
          [name]
        );
        let rowCount = 0;
        try {
          rowCount = Number((await run(`SELECT COUNT(*) AS N FROM "${schema}"."${name}"`))[0].N);
        } catch {
          /* perms */
        }
        out.push({
          name,
          rowCount,
          columns: cols.map((c) => ({
            name: c.COLUMN_NAME,
            type: sfType(c.DATA_TYPE),
            notnull: c.IS_NULLABLE === 'NO',
            pk: false, // PK metadata needs SHOW PRIMARY KEYS; declare keys in-studio
          })),
          fks: [],
        });
      }
      return out;
    },
    async page(table, limit, offset) {
      return run(`SELECT * FROM "${schema}"."${table}" LIMIT ${Number(limit)} OFFSET ${Number(offset)}`);
    },
    async query(sql) {
      return run(sql);
    },
    close() {
      connPromise?.then((c) => c.destroy(() => {})).catch(() => {});
    },
  };
}
