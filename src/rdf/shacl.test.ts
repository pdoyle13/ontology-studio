import { describe, it, expect } from 'vitest';
import { datatypeToKind } from './shacl';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

describe('datatypeToKind', () => {
    it('returns auto for a null datatype', () => {
        expect(datatypeToKind(null)).toBe('auto');
    });

    it('maps integer family', () => {
        for (const t of ['integer', 'int', 'long', 'nonNegativeInteger', 'positiveInteger']) {
            expect(datatypeToKind(`${XSD}${t}`)).toBe('integer');
        }
    });

    it('maps decimal family', () => {
        for (const t of ['decimal', 'float', 'double']) {
            expect(datatypeToKind(`${XSD}${t}`)).toBe('decimal');
        }
    });

    it('maps boolean, date, dateTime exactly', () => {
        expect(datatypeToKind(`${XSD}boolean`)).toBe('boolean');
        expect(datatypeToKind(`${XSD}date`)).toBe('date');
        expect(datatypeToKind(`${XSD}dateTime`)).toBe('dateTime');
    });

    it('defaults anything else to string', () => {
        expect(datatypeToKind(`${XSD}string`)).toBe('string');
        expect(datatypeToKind(`${XSD}anyURI`)).toBe('string');
        expect(datatypeToKind('https://custom/type')).toBe('string');
    });
});
