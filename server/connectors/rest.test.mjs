import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { create, parseGuardedSelect } from './rest.mjs';

const USERS = [
    { id: 1, name: 'Ada', role: 'admin', org: { team: 'core' } },
    { id: 2, name: 'Brin', role: 'editor', org: { team: 'apps' } },
    { id: 3, name: 'Cody', role: 'editor', org: { team: 'core' } },
];

let server;
let base;

beforeAll(async () => {
    server = createServer((req, res) => {
        if (req.url.startsWith('/users')) {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ data: { items: USERS } }));
        } else {
            res.statusCode = 404;
            res.end('{}');
        }
    });
    await new Promise((r) => server.listen(0, r));
    base = `http://localhost:${server.address().port}`;
});

afterAll(() => server.close());

const driver = () =>
    create('api', {
        baseUrl: base,
        allowPrivateHost: true, // test server runs on loopback; opt in past the SSRF guard
        resources: [{ name: 'users', path: '/users', rowsPath: 'data.items' }],
    });

describe('rest connector', () => {
    it('blocks a private/loopback baseUrl without the opt-in (SSRF guard, P1.4)', async () => {
        const d = create('evil', {
            baseUrl: 'http://169.254.169.254',
            resources: [{ name: 'meta', path: '/latest/meta-data/', rowsPath: '' }],
        });
        await expect(d.query(`SELECT "x" FROM "meta" LIMIT 1`)).rejects.toThrow(/private|blocked/);
    });

    it('lists resources as tables and introspects columns from rows', async () => {
        const d = driver();
        expect(await d.tables()).toEqual(['users']);
        const [t] = await d.introspect();
        expect(t.rowCount).toBe(3);
        expect(t.columns.map((c) => c.name).sort()).toEqual(['id', 'name', 'org', 'role']);
        expect(t.columns.find((c) => c.name === 'id').type).toBe('NUMERIC');
    });

    it('pages rows and stringifies nested objects', async () => {
        const d = driver();
        const rows = await d.page('users', 2, 1);
        expect(rows).toHaveLength(2);
        expect(rows[0].name).toBe('Brin');
        expect(rows[0].org).toBe('{"team":"apps"}');
    });

    it('evaluates the federation SELECT grammar: filter, order, project, limit', async () => {
        const d = driver();
        const rows = await d.query(
            `SELECT "name", "id" FROM "users" WHERE "role" = 'editor' ORDER BY "id" DESC LIMIT 5`,
        );
        expect(rows).toEqual([
            { name: 'Cody', id: 3 },
            { name: 'Brin', id: 2 },
        ]);
    });

    it('evaluates ILIKE via the portable LOWER-LIKE form', async () => {
        const d = driver();
        const rows = await d.query(`SELECT "name" FROM "users" WHERE LOWER("name") LIKE '%od%' LIMIT 10`);
        expect(rows).toEqual([{ name: 'Cody' }]);
    });

    it('rejects SQL outside the guarded shape', () => {
        expect(() => parseGuardedSelect('DROP TABLE users')).toThrow(/unsupported SQL shape/);
        expect(() => parseGuardedSelect(`SELECT "a" FROM "users" WHERE "a" IN (1,2) LIMIT 5`)).toThrow(
            /unsupported WHERE/,
        );
    });
});
