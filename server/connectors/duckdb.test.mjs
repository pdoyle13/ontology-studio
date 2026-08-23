import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create } from './duckdb.mjs';
import { connectorKinds, createDriver, safeDescriptor } from './registry.mjs';

const dir = mkdtempSync(join(tmpdir(), 'studio-duck-'));
const dbPath = join(dir, 'test.duckdb');
let driver;

beforeAll(async () => {
  // build a fixture with a writable connection, then open read-only via the driver
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const inst = await DuckDBInstance.create(dbPath);
  const conn = await inst.connect();
  await conn.run(`CREATE TABLE parts (id INTEGER PRIMARY KEY, sku VARCHAR NOT NULL, price DECIMAL(8,2))`);
  await conn.run(`INSERT INTO parts VALUES (1, 'SKU-100', 9.99), (2, 'SKU-200', 19.5)`);
  conn.closeSync();
  inst.closeSync?.();
  driver = create('duck1', dbPath);
});

afterAll(() => {
  driver?.close();
  setTimeout(() => rmSync(dir, { recursive: true, force: true }), 200);
});

describe('duckdb connector', () => {
  it('lists tables and introspects columns/types/pk', async () => {
    expect(await driver.tables()).toEqual(['parts']);
    const [t] = await driver.introspect();
    expect(t.rowCount).toBe(2);
    const byName = Object.fromEntries(t.columns.map((c) => [c.name, c]));
    expect(byName.id.type).toBe('INTEGER');
    expect(byName.id.pk).toBe(true);
    expect(byName.sku.type).toBe('TEXT');
    expect(byName.sku.notnull).toBe(true);
    expect(byName.price.type).toBe('DECIMAL');
  });

  it('pages and queries with plain JS values (no BigInt leaks)', async () => {
    const rows = await driver.page('parts', 10, 0);
    expect(rows).toHaveLength(2);
    expect(typeof rows[0].id).toBe('number');
    const q = await driver.query("SELECT sku FROM parts WHERE price > 10");
    expect(q).toEqual([{ sku: 'SKU-200' }]);
  });
});

describe('registry', () => {
  it('discovers all connectors from the directory', () => {
    const kinds = connectorKinds().map((m) => m.kind).sort();
    expect(kinds).toEqual(['duckdb', 'mysql', 'postgres', 'snowflake', 'sqlite']);
  });

  it('creates by kind and rejects unknown kinds', async () => {
    const d = createDriver({ id: 'x', kind: 'duckdb', target: dbPath });
    expect(d.kind).toBe('duckdb');
    d.close();
    expect(() => createDriver({ id: 'x', kind: 'oracle', target: '' })).toThrow(/unknown connector kind/);
  });

  it('strips credentials per target kind', () => {
    expect(safeDescriptor('mysql', 'mysql://u:pw@host:3306/db')).not.toContain('pw');
    expect(safeDescriptor('snowflake', '{"account":"a","password":"pw"}')).not.toContain('pw');
    expect(safeDescriptor('sqlite', 'C:/x.db')).toBe('C:/x.db');
  });
});
