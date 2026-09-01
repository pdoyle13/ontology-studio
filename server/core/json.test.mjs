// Prototype-pollution guard tests (remediation P1.8).
import { describe, it, expect } from 'vitest';
import { parseJsonSafe, stripProto } from './json.mjs';

describe('parseJsonSafe', () => {
    it('parses normal JSON unchanged', () => {
        expect(parseJsonSafe('{"a":1,"b":[2,3]}')).toEqual({ a: 1, b: [2, 3] });
    });
    it('drops __proto__ / constructor / prototype keys', () => {
        const o = parseJsonSafe('{"__proto__":{"isAdmin":true},"constructor":1,"prototype":2,"ok":3}');
        expect(o.ok).toBe(3);
        expect(Object.prototype.hasOwnProperty.call(o, '__proto__')).toBe(false);
        expect(o.constructor).toBe(Object); // untouched native, not the injected 1
    });
    it('does not pollute Object.prototype', () => {
        parseJsonSafe('{"__proto__":{"polluted":"yes"}}');
        expect({}.polluted).toBeUndefined();
    });
});

describe('stripProto', () => {
    it('recursively removes dangerous keys from parsed objects', () => {
        const dirty = JSON.parse('{"a":{"__proto__":{"x":1},"b":2}}');
        const clean = stripProto(dirty);
        expect(clean).toEqual({ a: { b: 2 } });
    });
    it('passes primitives and arrays through', () => {
        expect(stripProto(5)).toBe(5);
        expect(stripProto(['a', 'b'])).toEqual(['a', 'b']);
    });
});
