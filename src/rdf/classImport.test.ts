import { describe, it, expect } from 'vitest';
import { parseCsv, mapHeaders } from './csvImport';
import { labelField, validateClassRows, buildClassTriples, applyTemplate } from './classImport';
import { builtinFields } from './skosExt';
import type { PropertyShapeInfo } from './shacl';

const CLASS = 'https://studio.local/ns#DataDomain';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

const custom = (over: Partial<PropertyShapeInfo>): PropertyShapeInfo => ({
    ...builtinFields('concept')[0],
    path: 'https://studio.local/vocab/owner',
    name: 'Owner',
    minCount: null,
    maxCount: 1,
    datatype: `${XSD}string`,
    ...over,
});

const FIELDS = [
    labelField(),
    custom({}),
    custom({ path: 'https://studio.local/vocab/tier', name: 'Tier', datatype: `${XSD}integer` }),
];

describe('class import', () => {
    const csv = parseCsv('Label,Owner,Tier\nSales,alice,1\nFinance,bob,2\n,carol,3\nSales,dave,x');
    const map = mapHeaders(csv[0], FIELDS);
    const rows = csv.slice(1);

    it('maps the Label pseudo-field and customs by name', () => {
        expect(map.columns[0]!.path).toContain('rdf-schema#label');
        expect(map.columns[1]!.name).toBe('Owner');
        expect(map.columns[2]!.name).toBe('Tier');
    });

    it('validates labels, dupes, existing conflicts, and datatypes', () => {
        const reps = validateClassRows(rows, map, { classIri: CLASS, existingLabels: new Set(['finance']) });
        expect(reps[0].errors).toEqual([]);
        expect(reps[1].errors[0]).toMatch(/already exists/);
        expect(reps[2].errors[0]).toMatch(/missing label/);
        expect(reps[3].errors.some((e) => e.includes('duplicate'))).toBe(true);
        expect(reps[3].errors.some((e) => e.includes('integer'))).toBe(true);
    });

    it('builds typed triples only for valid rows', () => {
        const reps = validateClassRows(rows, map, { classIri: CLASS, existingLabels: new Set() });
        const { triples, imported } = buildClassTriples(rows, map, reps, { classIri: CLASS });
        expect(imported).toBe(2);
        const text = triples.join('\n');
        expect(text).toContain(
            `<https://studio.local/ns#sales> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${CLASS}>`,
        );
        expect(text).toContain('"alice"');
        expect(text).toContain(`"1"^^<${XSD}integer>`);
    });

    it('applyTemplate overrides auto-mapping per header (and can ignore)', () => {
        const tpl = { Owner: '', Tier: 'https://studio.local/vocab/owner' };
        const remapped = applyTemplate(csv[0], map, FIELDS, tpl);
        expect(remapped.columns[1]).toBeNull(); // ignored
        expect(remapped.columns[2]!.name).toBe('Owner'); // redirected
        expect(applyTemplate(csv[0], map, FIELDS, null)).toBe(map);
    });
});
