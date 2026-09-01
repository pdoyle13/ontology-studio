import { describe, it, expect } from 'vitest';
import { parseCsv, mapHeaders, validateRows, buildImportTriples } from './csvImport';
import { builtinFields } from './skosExt';

const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const FIELDS = builtinFields('concept');
const SCHEME = 'https://studio.local/taxonomy/test';

describe('parseCsv', () => {
    it('parses simple rows', () => {
        expect(parseCsv('a,b\n1,2')).toEqual([
            ['a', 'b'],
            ['1', '2'],
        ]);
    });

    it('handles quoted commas, escaped quotes, embedded newlines, CRLF', () => {
        const rows = parseCsv('label,def\r\n"Widgets, large","He said ""hi""\nsecond line"');
        expect(rows[1][0]).toBe('Widgets, large');
        expect(rows[1][1]).toBe('He said "hi"\nsecond line');
    });

    it('drops fully blank lines', () => {
        expect(parseCsv('a,b\n,\n1,2')).toEqual([
            ['a', 'b'],
            ['1', '2'],
        ]);
    });
});

describe('mapHeaders', () => {
    it('maps common spreadsheet spellings and flags broader + ignored', () => {
        const m = mapHeaders(['Term', 'Parent', 'Synonyms', 'Description', 'Unknown Col'], FIELDS);
        expect(m.prefCol).toBe(0);
        expect(m.broaderCol).toBe(1);
        expect(m.columns[2]!.path).toBe(`${SKOS}altLabel`);
        expect(m.columns[3]!.path).toBe(`${SKOS}definition`);
        expect(m.ignored).toEqual(['Unknown Col']);
    });

    it('maps custom fields by their sh:name', () => {
        const custom = { ...FIELDS[0], path: 'https://studio.local/vocab/status', name: 'Status', minCount: null };
        const m = mapHeaders(['Pref Label', 'status'], [...FIELDS, custom]);
        expect(m.columns[1]!.path).toBe('https://studio.local/vocab/status');
    });
});

describe('validateRows', () => {
    const map = mapHeaders(['Label', 'Broader'], FIELDS);

    it('flags missing labels, duplicates, and unknown broader', () => {
        const rows = [
            ['Alpha', ''],
            ['', ''],
            ['Alpha', ''],
            ['Child', 'Nope'],
        ];
        const reps = validateRows(rows, map, { scheme: SCHEME, existing: [] });
        expect(reps[0].errors).toEqual([]);
        expect(reps[1].errors[0]).toMatch(/missing preferred label/);
        expect(reps[2].errors[0]).toMatch(/duplicate of row 1/);
        expect(reps[3].errors[0]).toMatch(/matches no existing concept or earlier row/);
    });

    it('resolves broader against earlier rows (top-down tree in one file)', () => {
        const rows = [
            ['Parent', ''],
            ['Child', 'Parent'],
        ];
        const reps = validateRows(rows, map, { scheme: SCHEME, existing: [] });
        expect(reps[1].errors).toEqual([]);
        expect(reps[1].broaderIri).toBe(`${SCHEME}/parent`);
    });

    it('resolves broader against existing concepts by label, case-insensitive', () => {
        const reps = validateRows([['Child', 'hardware']], map, {
            scheme: SCHEME,
            existing: [{ iri: 'https://x/hw', label: 'Hardware' }],
        });
        expect(reps[0].broaderIri).toBe('https://x/hw');
    });

    it('rejects labels that already exist in the scheme', () => {
        const reps = validateRows([['Hardware', '']], map, {
            scheme: SCHEME,
            existing: [{ iri: 'https://x/hw', label: 'Hardware' }],
        });
        expect(reps[0].errors[0]).toMatch(/already exists/);
    });
});

describe('buildImportTriples', () => {
    it('builds triples only for valid rows, splitting multi-values', () => {
        const map = mapHeaders(['Label', 'Broader', 'Synonyms'], FIELDS);
        const rows = [
            ['Parent', '', 'P1 | P2'],
            ['', '', ''],
            ['Child', 'Parent', ''],
        ];
        const reps = validateRows(rows, map, { scheme: SCHEME, existing: [] });
        const { triples, imported } = buildImportTriples(rows, map, reps, { scheme: SCHEME, fields: FIELDS });
        expect(imported).toBe(2);
        const text = triples.join('\n');
        expect(text).toContain(`<${SCHEME}/parent> <${SKOS}topConceptOf>`);
        expect(text).toContain(`<${SCHEME}/child> <${SKOS}broader> <${SCHEME}/parent>`);
        expect(triples.filter((t) => t.includes('altLabel'))).toHaveLength(2);
    });
});
