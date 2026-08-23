import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { parseBiSql, startPgFacade, readMessages } from './pgFacade.mjs';

describe('parseBiSql', () => {
  it('handshake probes', () => {
    expect(parseBiSql('SELECT 1')).toMatchObject({ kind: 'const' });
    expect(parseBiSql('select version();')).toMatchObject({ kind: 'const' });
  });

  it('select with columns, where, limit', () => {
    const q = parseBiSql(`SELECT order_number, status FROM orders WHERE status = 'shipped' AND id > 10 LIMIT 25`);
    expect(q).toEqual({
      kind: 'select',
      table: 'orders',
      columns: ['order_number', 'status'],
      filters: [
        { column: 'status', op: '=', value: 'shipped' },
        { column: 'id', op: '>', value: 10 },
      ],
      limit: 25,
    });
  });

  it('star select, quoted and schema-qualified tables', () => {
    expect(parseBiSql('SELECT * FROM "customers"')).toMatchObject({ kind: 'select', table: 'customers', columns: null });
    expect(parseBiSql('SELECT * FROM public.orders LIMIT 5')).toMatchObject({ table: 'public.orders'.replace(/^public\./i, '') });
  });

  it('information_schema probes', () => {
    expect(parseBiSql('SELECT table_name FROM information_schema.tables')).toEqual({ kind: 'tables' });
    expect(parseBiSql(`SELECT column_name FROM information_schema.columns WHERE table_name = 'orders'`)).toEqual({ kind: 'columns', table: 'orders' });
  });

  it('rejects writes and weird SQL', () => {
    expect(parseBiSql('DROP TABLE orders')).toEqual({ kind: 'unsupported' });
    expect(parseBiSql("SELECT * FROM orders WHERE status = 'x' OR 1=1")).toEqual({ kind: 'unsupported' });
  });
});

describe('readMessages framing', () => {
  it('recognizes SSLRequest and startup, then typed messages', () => {
    const ssl = Buffer.alloc(8);
    ssl.writeUInt32BE(8, 0);
    ssl.writeUInt32BE(80877103, 4);
    expect(readMessages(ssl, false).sawSslRequest).toBe(true);

    const body = Buffer.from('user\0pat\0database\0studio\0\0', 'utf8');
    const startup = Buffer.concat([Buffer.alloc(8), body]);
    startup.writeUInt32BE(startup.length, 0);
    startup.writeUInt32BE(196608, 4);
    const r = readMessages(startup, false);
    expect(r.startup).toEqual({ user: 'pat', database: 'studio' });
  });
});

describe('end-to-end with the real pg client', () => {
  let server;
  let port;
  const CATALOG = [
    {
      classIri: 'c:orders',
      table: 'orders',
      sourceId: 'sales_db',
      subjectTemplate: 'c:orders/{id}',
      columns: [
        { column: 'id', property: 'p:id' },
        { column: 'order_number', property: 'p:on' },
        { column: 'status', property: 'p:st' },
      ],
      refs: [],
    },
  ];
  const federation = {
    readCatalog: async () => CATALOG,
    queryClass: async ({ columns, filters, limit }) => ({
      rows: [
        { id: 1, order_number: 'ORD-1001', status: 'shipped' },
        { id: 2, order_number: 'ORD-1002', status: 'pending' },
      ]
        .filter((r) => (filters ?? []).every((f) => (f.op === '=' ? String(r[f.column]) === String(f.value) : true)))
        .slice(0, limit)
        .map((r) => (columns ? Object.fromEntries(columns.map((c) => [c, r[c]])) : r)),
    }),
  };

  beforeAll(async () => {
    port = 15600 + Math.floor(Math.random() * 200);
    server = startPgFacade({ port, federation });
    await new Promise((r) => setTimeout(r, 150));
  });

  afterAll(() => {
    server?.close();
  });

  it('a stock Postgres client lists tables and queries a business object', async () => {
    const client = new pg.Client({ host: '127.0.0.1', port, user: 'tableau', database: 'studio', ssl: false });
    await client.connect();
    const tables = await client.query('SELECT table_name FROM information_schema.tables');
    expect(tables.rows.map((r) => r.table_name)).toContain('orders');

    const all = await client.query('SELECT * FROM orders LIMIT 10');
    expect(all.rows).toHaveLength(2);
    expect(all.rows[0].order_number).toBe('ORD-1001');

    const filtered = await client.query(`SELECT order_number FROM orders WHERE status = 'shipped'`);
    expect(filtered.rows).toEqual([{ order_number: 'ORD-1001' }]);
    await client.end();
  });

  it('errors surface as SQL errors, connection stays usable', async () => {
    const client = new pg.Client({ host: '127.0.0.1', port, user: 'x', database: 'studio', ssl: false });
    await client.connect();
    await expect(client.query('SELECT * FROM nope')).rejects.toThrow(/unknown table/);
    const ok = await client.query('SELECT 1');
    expect(ok.rows).toHaveLength(1);
    await client.end();
  });
});
