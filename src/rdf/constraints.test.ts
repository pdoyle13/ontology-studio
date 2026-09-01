import { describe, it, expect } from 'vitest';
import { widgetFor, validateAgainstShape } from './constraints';
import type { PropertyShapeInfo } from './shacl';

const ps = (over: Partial<PropertyShapeInfo>): PropertyShapeInfo => ({
    shapeIri: 'http://ex.org/S',
    path: 'http://ex.org/p',
    name: null,
    description: null,
    codelist: null,
    datatype: null,
    classIri: null,
    nodeKind: null,
    minCount: null,
    maxCount: null,
    order: 1,
    minInclusive: null,
    maxInclusive: null,
    pattern: null,
    singleLine: null,
    maxLength: null,
    inValues: null,
    ...over,
});

const XSD = 'http://www.w3.org/2001/XMLSchema#';

describe('widgetFor', () => {
    it('maps datatypes to widgets', () => {
        expect(widgetFor(ps({ datatype: `${XSD}integer` }))).toBe('number');
        expect(widgetFor(ps({ datatype: `${XSD}decimal` }))).toBe('number');
        expect(widgetFor(ps({ datatype: `${XSD}boolean` }))).toBe('boolean');
        expect(widgetFor(ps({ datatype: `${XSD}date` }))).toBe('date');
        expect(widgetFor(ps({ datatype: `${XSD}dateTime` }))).toBe('datetime');
        expect(widgetFor(ps({ datatype: `${XSD}string` }))).toBe('text');
        expect(widgetFor(ps({}))).toBe('text');
    });

    it('sh:class wins as iri, sh:in wins as enum', () => {
        expect(widgetFor(ps({ classIri: 'http://ex.org/C' }))).toBe('iri');
        expect(widgetFor(ps({ datatype: `${XSD}integer`, inValues: [{ value: '1', isIri: false }] }))).toBe('enum');
    });
});

describe('validateAgainstShape', () => {
    it('accepts valid values', () => {
        expect(validateAgainstShape(ps({ datatype: `${XSD}integer` }), '42')).toBeNull();
        expect(validateAgainstShape(ps({ datatype: `${XSD}decimal` }), '-3.5')).toBeNull();
        expect(validateAgainstShape(ps({ datatype: `${XSD}boolean` }), 'true')).toBeNull();
        expect(validateAgainstShape(ps({ datatype: `${XSD}date` }), '2026-08-22')).toBeNull();
        expect(validateAgainstShape(ps({ datatype: `${XSD}dateTime` }), '2026-08-22T14:30')).toBeNull();
        expect(validateAgainstShape(ps({}), 'anything')).toBeNull();
    });

    it('rejects malformed typed values', () => {
        expect(validateAgainstShape(ps({ datatype: `${XSD}integer` }), '4.2')).toMatch(/integer/);
        expect(validateAgainstShape(ps({ datatype: `${XSD}boolean` }), 'yes')).toMatch(/true or false/);
        expect(validateAgainstShape(ps({ datatype: `${XSD}date` }), '22/08/2026')).toMatch(/date/);
        expect(validateAgainstShape(ps({}), '   ')).toMatch(/empty/);
    });

    it('enforces minInclusive / maxInclusive on numbers', () => {
        const shape = ps({ datatype: `${XSD}integer`, minInclusive: '1900', maxInclusive: '2100' });
        expect(validateAgainstShape(shape, '1997')).toBeNull();
        expect(validateAgainstShape(shape, '1850')).toMatch(/≥ 1900/);
        expect(validateAgainstShape(shape, '3000')).toMatch(/≤ 2100/);
    });

    it('enforces sh:pattern and tolerates invalid regexes', () => {
        expect(validateAgainstShape(ps({ pattern: '^[A-Z]{3}$' }), 'ABC')).toBeNull();
        expect(validateAgainstShape(ps({ pattern: '^[A-Z]{3}$' }), 'abc')).toMatch(/pattern/);
        expect(validateAgainstShape(ps({ pattern: '([' }), 'anything')).toBeNull();
    });

    it('enforces sh:in enumerations', () => {
        const shape = ps({
            inValues: [
                { value: 'rock', isIri: false },
                { value: 'jazz', isIri: false },
            ],
        });
        expect(validateAgainstShape(shape, 'rock')).toBeNull();
        expect(validateAgainstShape(shape, 'polka')).toMatch(/one of/);
    });
});

describe('widgets round 2', () => {
    const LANG = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString';

    it('rdf:langString renders the lang-text widget', () => {
        expect(widgetFor(ps({ datatype: LANG }))).toBe('langtext');
    });

    it('dash:singleLine false renders a textarea', () => {
        expect(widgetFor(ps({ singleLine: false }))).toBe('textarea');
        expect(widgetFor(ps({ singleLine: true }))).toBe('text');
    });

    it('sh:class still wins over singleLine', () => {
        expect(widgetFor(ps({ singleLine: false, classIri: 'http://ex.org/C' }))).toBe('iri');
    });

    it('enforces sh:maxLength', () => {
        expect(validateAgainstShape(ps({ maxLength: 5 }), 'abcdef')).toMatch(/at most 5/);
        expect(validateAgainstShape(ps({ maxLength: 5 }), 'abcde')).toBeNull();
    });
});
