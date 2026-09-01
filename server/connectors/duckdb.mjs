// DuckDB analytics files. The client only creates instances asynchronously,
// so the connection is lazy — created on first use, shared afterwards.

export const meta = { kind: 'duckdb', label: 'DuckDB file', targetKind: 'file' };

const plain = (v) => {
    if (typeof v === 'bigint') return Number(v);
    if (v && typeof v === 'object' && Array.isArray(v.items)) return v.items.map(plain);
    if (v && typeof v === 'object' && v.constructor?.name?.startsWith('DuckDB')) return v.toString();
    return v;
};

const duckType = (t) => {
    const u = String(t).toUpperCase();
    if (/INT/.test(u)) return 'INTEGER';
    if (/DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL/.test(u)) return 'DECIMAL';
    if (/BOOL/.test(u)) return 'BOOLEAN';
    if (/TIMESTAMP/.test(u)) return 'DATETIME';
    if (u === 'DATE') return 'DATE';
    if (/BLOB/.test(u)) return 'BLOB';
    return 'TEXT';
};

export function create(id, path) {
    let connPromise = null;
    const connect = () => {
        if (!connPromise) {
            connPromise = import('@duckdb/node-api').then(async ({ DuckDBInstance }) => {
                const inst = await DuckDBInstance.create(path, { access_mode: 'READ_ONLY' });
                return inst.connect();
            });
        }
        return connPromise;
    };
    const run = async (sql) => {
        const conn = await connect();
        const reader = await conn.runAndReadAll(sql);
        return reader.getRowObjects().map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)])));
    };
    return {
        id,
        kind: 'duckdb',
        target: path,
        async tables() {
            const rows = await run(
                "SELECT table_name FROM information_schema.tables WHERE table_schema='main' AND table_type='BASE TABLE' ORDER BY table_name",
            );
            return rows.map((r) => r.table_name);
        },
        async introspect() {
            const names = await this.tables();
            const constraints = await run(
                'SELECT table_name, constraint_type, constraint_column_names FROM duckdb_constraints()',
            ).catch(() => []);
            const out = [];
            for (const name of names) {
                const esc = name.replace(/'/g, "''");
                const cols = await run(
                    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='main' AND table_name='${esc}' ORDER BY ordinal_position`,
                );
                const pkCols = new Set(
                    constraints
                        .filter((c) => c.table_name === name && c.constraint_type === 'PRIMARY KEY')
                        .flatMap((c) => {
                            const v = c.constraint_column_names;
                            if (Array.isArray(v)) return v.map(String);
                            if (v && typeof v === 'object' && Array.isArray(v.items)) return v.items.map(String);
                            return String(v)
                                .replace(/[[\]]/g, '')
                                .split(',')
                                .map((x) => x.trim());
                        }),
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
                        type: duckType(c.data_type),
                        notnull: c.is_nullable === 'NO',
                        pk: pkCols.has(c.column_name),
                    })),
                    // duckdb_constraints() omits FK target columns; declare cross-table links in-studio
                    fks: [],
                });
            }
            return out;
        },
        async page(table, limit, offset) {
            return run(`SELECT * FROM "${table}" LIMIT ${limit} OFFSET ${offset}`);
        },
        async query(sql) {
            return run(sql);
        },
        close() {
            connPromise?.then((c) => c.closeSync?.()).catch(() => {});
        },
    };
}
