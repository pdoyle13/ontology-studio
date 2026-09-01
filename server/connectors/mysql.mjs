// MySQL / MariaDB over a connection URL (mysql://user:pass@host:3306/dbname).

export const meta = { kind: 'mysql', label: 'MySQL / MariaDB URL', targetKind: 'url' };

const myType = (t) => {
    const u = String(t).toUpperCase();
    if (/INT/.test(u)) return 'INTEGER';
    if (/DECIMAL|NUMERIC|FLOAT|DOUBLE/.test(u)) return 'DECIMAL';
    if (/BOOL/.test(u)) return 'BOOLEAN';
    if (/DATETIME|TIMESTAMP/.test(u)) return 'DATETIME';
    if (u === 'DATE') return 'DATE';
    if (/BLOB|BINARY/.test(u)) return 'BLOB';
    return 'TEXT';
};

export function create(id, url) {
    let poolPromise = null;
    const getPool = () => {
        if (!poolPromise)
            poolPromise = import('mysql2/promise').then((m) => m.createPool({ uri: url, connectionLimit: 3 }));
        return poolPromise;
    };
    const run = async (sql, params = []) => {
        const pool = await getPool();
        const [rows] = await pool.query(sql, params);
        return rows;
    };
    return {
        id,
        kind: 'mysql',
        target: url,
        async tables() {
            const rows = await run(
                "SELECT table_name AS t FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE' ORDER BY table_name",
            );
            return rows.map((r) => r.t);
        },
        async introspect() {
            const names = await this.tables();
            const out = [];
            for (const name of names) {
                const cols = await run(
                    'SELECT column_name AS c, data_type AS d, is_nullable AS n, column_key AS k FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ordinal_position',
                    [name],
                );
                const fks = await run(
                    'SELECT column_name AS `from`, referenced_table_name AS `table`, referenced_column_name AS `to` FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name=? AND referenced_table_name IS NOT NULL',
                    [name],
                );
                let rowCount = 0;
                try {
                    rowCount = Number((await run('SELECT COUNT(*) AS n FROM ??', [name]))[0].n);
                } catch {
                    /* perms */
                }
                out.push({
                    name,
                    rowCount,
                    columns: cols.map((c) => ({
                        name: c.c,
                        type: myType(c.d),
                        notnull: c.n === 'NO',
                        pk: c.k === 'PRI',
                    })),
                    fks,
                });
            }
            return out;
        },
        async page(table, limit, offset) {
            return run('SELECT * FROM ?? LIMIT ? OFFSET ?', [table, limit, offset]);
        },
        async query(sql) {
            return run(sql);
        },
        close() {
            poolPromise?.then((p) => p.end()).catch(() => {});
        },
    };
}
