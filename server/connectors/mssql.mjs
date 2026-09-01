// Microsoft SQL Server over a connection URL
// (mssql://user:pass@host:1433/dbname). EXPERIMENTAL: written to the mssql
// (tedious) client surface; needs live-server validation.

export const meta = { kind: 'mssql', label: 'SQL Server URL', targetKind: 'url', experimental: true };

const msType = (t) => {
    const u = String(t).toUpperCase();
    if (/INT/.test(u)) return 'INTEGER';
    if (/DECIMAL|NUMERIC|FLOAT|REAL|MONEY/.test(u)) return 'DECIMAL';
    if (u === 'BIT') return 'BOOLEAN';
    if (/DATETIME|TIMESTAMP/.test(u)) return 'DATETIME';
    if (u === 'DATE') return 'DATE';
    if (/BINARY|IMAGE/.test(u)) return 'BLOB';
    return 'TEXT';
};

function parseUrl(url) {
    const u = new URL(url);
    return {
        server: u.hostname,
        port: Number(u.port || 1433),
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: u.pathname.replace(/^\//, ''),
        options: { trustServerCertificate: true, encrypt: u.searchParams.get('encrypt') !== 'false' },
    };
}

export function create(id, url) {
    let poolPromise = null;
    const getPool = () => {
        if (!poolPromise)
            poolPromise = import('mssql').then((m) => new m.default.ConnectionPool(parseUrl(url)).connect());
        return poolPromise;
    };
    const run = async (sql) => {
        const pool = await getPool();
        return (await pool.request().query(sql)).recordset ?? [];
    };
    const q = (name) => `[${String(name).replace(/]/g, ']]')}]`;
    return {
        id,
        kind: 'mssql',
        target: url,
        async tables() {
            const rows = await run(
                "SELECT TABLE_NAME AS t FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME",
            );
            return rows.map((r) => r.t);
        },
        async introspect() {
            const names = await this.tables();
            const out = [];
            for (const name of names) {
                const esc = name.replace(/'/g, "''");
                const cols = await run(
                    `SELECT COLUMN_NAME AS c, DATA_TYPE AS d, IS_NULLABLE AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${esc}' ORDER BY ORDINAL_POSITION`,
                );
                const pks = await run(
                    `SELECT kcu.COLUMN_NAME AS c FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
           JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON tc.CONSTRAINT_NAME=kcu.CONSTRAINT_NAME
           WHERE tc.CONSTRAINT_TYPE='PRIMARY KEY' AND tc.TABLE_NAME='${esc}'`,
                );
                const fks = await run(
                    `SELECT kcu.COLUMN_NAME AS [from], ccu.TABLE_NAME AS [table], ccu.COLUMN_NAME AS [to]
           FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
           JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON rc.CONSTRAINT_NAME=kcu.CONSTRAINT_NAME
           JOIN INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE ccu ON rc.UNIQUE_CONSTRAINT_NAME=ccu.CONSTRAINT_NAME
           WHERE kcu.TABLE_NAME='${esc}'`,
                );
                const pkSet = new Set(pks.map((r) => r.c));
                let rowCount = 0;
                try {
                    rowCount = Number((await run(`SELECT COUNT(*) AS n FROM ${q(name)}`))[0].n);
                } catch {
                    /* perms */
                }
                out.push({
                    name,
                    rowCount,
                    columns: cols.map((c) => ({
                        name: c.c,
                        type: msType(c.d),
                        notnull: c.n === 'NO',
                        pk: pkSet.has(c.c),
                    })),
                    fks,
                });
            }
            return out;
        },
        async page(table, limit, offset) {
            return run(
                `SELECT * FROM ${q(table)} ORDER BY (SELECT NULL) OFFSET ${Number(offset)} ROWS FETCH NEXT ${Number(limit)} ROWS ONLY`,
            );
        },
        async query(sql) {
            return run(sql);
        },
        close() {
            poolPromise?.then((p) => p.close()).catch(() => {});
        },
    };
}
