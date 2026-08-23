// BI facade: a PostgreSQL wire-protocol server that exposes every virtual
// class (business object) as a queryable table, so Tableau / Power BI /
// Looker / psql / any Postgres driver connect with stock drivers and the
// federation layer answers from the owning databases live.
//
// Implements the simple-query protocol (startup, SSLRequest declined,
// AuthenticationOk, Q → RowDescription/DataRow/CommandComplete). That is the
// path node-postgres and psql use for unparameterized queries; BI tools'
// extended-protocol probing is future work.

import net from 'node:net';

// ---------- pure: message codec ----------

export function readMessages(buffer, startupDone) {
  // returns {messages: [{type, payload}], rest, sawSslRequest, sawStartup:{params}|null}
  const out = { messages: [], rest: buffer, sawSslRequest: false, startup: null };
  let buf = buffer;
  if (!startupDone) {
    if (buf.length < 8) return { ...out, rest: buf };
    const len = buf.readUInt32BE(0);
    const code = buf.readUInt32BE(4);
    if (code === 80877103) {
      // SSLRequest
      out.sawSslRequest = true;
      buf = buf.subarray(8);
      out.rest = buf;
      return out;
    }
    if (buf.length < len) return { ...out, rest: buf };
    if (code === 196608) {
      // StartupMessage v3: key\0value\0...\0
      const params = {};
      const body = buf.subarray(8, len - 1);
      const parts = body.toString('utf8').split('\0').filter(Boolean);
      for (let i = 0; i + 1 < parts.length; i += 2) params[parts[i]] = parts[i + 1];
      out.startup = params;
      out.rest = buf.subarray(len);
      return out;
    }
    // unknown pre-startup message: swallow it
    out.rest = buf.subarray(len);
    return out;
  }
  for (;;) {
    if (buf.length < 5) break;
    const type = String.fromCharCode(buf[0]);
    const len = buf.readUInt32BE(1);
    if (buf.length < 1 + len) break;
    out.messages.push({ type, payload: buf.subarray(5, 1 + len) });
    buf = buf.subarray(1 + len);
  }
  out.rest = buf;
  return out;
}

const msg = (type, body) => {
  const b = Buffer.concat([Buffer.alloc(4), body]);
  b.writeUInt32BE(b.length, 0);
  return Buffer.concat([Buffer.from(type), b]);
};
const cstr = (s) => Buffer.from(`${s}\0`, 'utf8');

export function authOk() {
  const auth = Buffer.alloc(4);
  auth.writeUInt32BE(0);
  return msg('R', auth);
}

export function parameterStatus(key, value) {
  return msg('S', Buffer.concat([cstr(key), cstr(value)]));
}

export function readyForQuery() {
  return msg('Z', Buffer.from('I'));
}

export function rowDescription(columns) {
  const head = Buffer.alloc(2);
  head.writeUInt16BE(columns.length);
  const fields = columns.map((name) => {
    const f = Buffer.alloc(18);
    f.writeUInt32BE(0, 0); // table oid
    f.writeUInt16BE(0, 4); // attnum
    f.writeUInt32BE(25, 6); // type oid: text
    f.writeInt16BE(-1, 10); // typlen
    f.writeInt32BE(-1, 12); // typmod
    f.writeUInt16BE(0, 16); // format: text
    return Buffer.concat([cstr(name), f]);
  });
  return msg('T', Buffer.concat([head, ...fields]));
}

export function dataRow(values) {
  const head = Buffer.alloc(2);
  head.writeUInt16BE(values.length);
  const cells = values.map((v) => {
    if (v === null || v === undefined) {
      const b = Buffer.alloc(4);
      b.writeInt32BE(-1);
      return b;
    }
    const s = Buffer.from(String(v), 'utf8');
    const b = Buffer.alloc(4);
    b.writeInt32BE(s.length);
    return Buffer.concat([b, s]);
  });
  return msg('D', Buffer.concat([head, ...cells]));
}

export function commandComplete(tag) {
  return msg('C', cstr(tag));
}

export function errorResponse(text) {
  return msg('E', Buffer.concat([Buffer.from('S'), cstr('ERROR'), Buffer.from('C'), cstr('42000'), Buffer.from('M'), cstr(text), Buffer.from([0])]));
}

// ---------- pure: the SQL subset BI clients send ----------

/**
 * Parse `SELECT <cols|*> FROM <table> [WHERE col <op> lit [AND ...]] [LIMIT n]`
 * plus the handshake probes (SELECT 1, version(), current_schema()).
 */
export function parseBiSql(sql) {
  const s = sql.trim().replace(/;\s*$/, '');
  if (/^select\s+1$/i.test(s)) return { kind: 'const', columns: ['?column?'], row: ['1'] };
  if (/^select\s+version\(\)/i.test(s)) return { kind: 'const', columns: ['version'], row: ['PostgreSQL 15.0 (YAOE semantic facade)'] };
  if (/^select\s+current_schema\(\)/i.test(s)) return { kind: 'const', columns: ['current_schema'], row: ['public'] };
  if (/information_schema\.tables/i.test(s)) return { kind: 'tables' };
  if (/information_schema\.columns/i.test(s)) {
    const m = /table_name\s*=\s*'([^']+)'/i.exec(s);
    return { kind: 'columns', table: m?.[1] ?? null };
  }
  const m = /^select\s+(.+?)\s+from\s+"?([\w.]+)"?\s*(?:where\s+(.+?))?\s*(?:limit\s+(\d+))?$/is.exec(s);
  if (!m) return { kind: 'unsupported' };
  const columns = m[1].trim() === '*' ? null : m[1].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  const filters = [];
  if (m[3]) {
    for (const clause of m[3].split(/\s+and\s+/i)) {
      const f = /^"?([\w]+)"?\s*(=|!=|<>|>=|<=|>|<|like)\s*(?:'([^']*)'|(\d+(?:\.\d+)?))$/i.exec(clause.trim());
      if (!f) return { kind: 'unsupported' };
      filters.push({ column: f[1], op: f[2] === '<>' ? '!=' : f[2].toUpperCase(), value: f[3] ?? Number(f[4]) });
    }
  }
  return { kind: 'select', table: m[2].replace(/^public\./i, ''), columns, filters, limit: m[4] ? Number(m[4]) : 200 };
}

// ---------- server ----------

/**
 * Start the facade. federation: {readCatalog, queryClass}. Tables are the
 * catalog's table names (business objects); columns come from the mappings.
 */
export function startPgFacade({ port, federation, log = () => {} }) {
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    let started = false;

    const send = (...msgs) => socket.write(Buffer.concat(msgs));

    const handleQuery = async (sql) => {
      try {
        const q = parseBiSql(sql);
        const catalog = await federation.readCatalog();
        if (q.kind === 'const') {
          send(rowDescription(q.columns), dataRow(q.row), commandComplete('SELECT 1'), readyForQuery());
          return;
        }
        if (q.kind === 'tables') {
          send(rowDescription(['table_name']));
          for (const c of catalog) send(dataRow([c.table]));
          send(commandComplete(`SELECT ${catalog.length}`), readyForQuery());
          return;
        }
        if (q.kind === 'columns') {
          const entry = catalog.find((c) => c.table === q.table);
          const cols = entry ? entry.columns.map((c) => c.column) : [];
          send(rowDescription(['column_name']));
          for (const c of cols) send(dataRow([c]));
          send(commandComplete(`SELECT ${cols.length}`), readyForQuery());
          return;
        }
        if (q.kind === 'select') {
          const entry = catalog.find((c) => c.table === q.table);
          if (!entry) throw new Error(`unknown table: ${q.table}`);
          const result = await federation.queryClass({
            classIri: entry.classIri,
            columns: q.columns ?? undefined,
            filters: q.filters,
            limit: q.limit,
            catalog,
          });
          const cols = q.columns ?? entry.columns.map((c) => c.column);
          send(rowDescription(cols));
          for (const r of result.rows) send(dataRow(cols.map((c) => r[c])));
          send(commandComplete(`SELECT ${result.rows.length}`), readyForQuery());
          return;
        }
        throw new Error('unsupported SQL for the BI facade (SELECT ... FROM <business object> [WHERE ...] [LIMIT n])');
      } catch (e) {
        send(errorResponse(e.message), readyForQuery());
      }
    };

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const r = readMessages(buf, started);
        buf = r.rest;
        if (r.sawSslRequest) {
          socket.write(Buffer.from('N')); // no TLS — plaintext local facade
          continue;
        }
        if (r.startup) {
          started = true;
          send(
            authOk(),
            parameterStatus('server_version', '15.0'),
            parameterStatus('server_encoding', 'UTF8'),
            parameterStatus('client_encoding', 'UTF8'),
            readyForQuery()
          );
          continue;
        }
        if (r.messages.length === 0) break;
        for (const m of r.messages) {
          if (m.type === 'Q') {
            const sql = m.payload.toString('utf8').replace(/\0$/, '');
            log(`bi-facade: ${sql.slice(0, 120)}`);
            handleQuery(sql);
          } else if (m.type === 'X') {
            socket.end();
          }
          // P/B/D/E/S (extended protocol) intentionally unhandled for now
        }
      }
    });
    socket.on('error', () => {});
  });
  server.listen(port);
  return server;
}
