import { describe, it, expect } from 'vitest';
import { parseTurtle } from './importExport';

describe('parseTurtle', () => {
    it('parses triples and captures declared prefixes', () => {
        const ttl = '@prefix ex: <https://ex.org/> .\nex:a ex:p "v" .\nex:a ex:q ex:b .';
        const { quads, prefixes } = parseTurtle(ttl);
        expect(quads).toHaveLength(2);
        expect(prefixes.ex).toBe('https://ex.org/');
        expect(quads[0].subject.value).toBe('https://ex.org/a');
        expect(quads[0].object.value).toBe('v');
    });

    it('returns no quads for empty input', () => {
        expect(parseTurtle('').quads).toHaveLength(0);
    });

    it('throws on malformed Turtle', () => {
        expect(() => parseTurtle('this is not <<< turtle')).toThrow();
    });
});
