import { describe, it, expect } from 'vitest';
import { pgTypeName, safeDescriptor } from './drivers.mjs';
import { rowsToBlocks, STUDIO_NS } from './semantic/translate.mjs';

describe('pgTypeName', () => {
    it('maps postgres information_schema types to SQL-ish names', () => {
        expect(pgTypeName('integer')).toBe('INTEGER');
        expect(pgTypeName('bigint')).toBe('INTEGER');
        expect(pgTypeName('numeric')).toBe('DECIMAL');
        expect(pgTypeName('double precision')).toBe('DECIMAL');
        expect(pgTypeName('boolean')).toBe('BOOLEAN');
        expect(pgTypeName('timestamp without time zone')).toBe('DATETIME');
        expect(pgTypeName('date')).toBe('DATE');
        expect(pgTypeName('bytea')).toBe('BLOB');
        expect(pgTypeName('character varying')).toBe('TEXT');
        expect(pgTypeName('text')).toBe('TEXT');
    });
});

describe('safeDescriptor', () => {
    it('strips credentials from postgres URLs', () => {
        const safe = safeDescriptor('postgres', 'postgres://user:secretpw@db.example.com:5432/orders');
        expect(safe).not.toContain('secretpw');
        expect(safe).not.toContain('user:');
        expect(safe).toContain('db.example.com:5432/orders');
    });

    it('passes sqlite paths through', () => {
        expect(safeDescriptor('sqlite', 'C:/data/x.db')).toBe('C:/data/x.db');
    });

    it('never throws on malformed URLs', () => {
        expect(safeDescriptor('postgres', 'not a url')).toBe('postgres://…');
    });
});

describe('rowsToBlocks provenance stamping', () => {
    const info = {
        name: 'orders',
        rowCount: 1,
        columns: [{ name: 'id', type: 'INTEGER', notnull: true, pk: true }],
        fks: [],
    };

    it('stamps fromSource + sourceTable when provenance is given', () => {
        const [block] = rowsToBlocks([{ id: 1 }], info, 'http://x/#', {
            sourceIri: 'https://studio.local/ns#source/orders_db',
        });
        expect(block).toContain(`<${STUDIO_NS}fromSource> <https://studio.local/ns#source/orders_db>`);
        expect(block).toContain(`<${STUDIO_NS}sourceTable> "orders"`);
    });

    it('emits no provenance triples without it', () => {
        const [block] = rowsToBlocks([{ id: 1 }], info, 'http://x/#');
        expect(block).not.toContain('fromSource');
    });
});
