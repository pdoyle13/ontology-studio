import { describe, it, expect } from 'vitest';
import { serializeTerm, parseTermInput } from './mutations';

const expand = (s: string) => (s.startsWith('ex:') ? `http://ex.org/${s.slice(3)}` : s);

describe('serializeTerm', () => {
  it('serializes IRIs and bnodes', () => {
    expect(serializeTerm({ type: 'uri', value: 'http://x.org/a' })).toBe('<http://x.org/a>');
    expect(serializeTerm({ type: 'bnode', value: 'b1' })).toBe('_:b1');
  });

  it('serializes plain, lang, and typed literals', () => {
    expect(serializeTerm({ type: 'literal', value: 'hi' })).toBe('"hi"');
    expect(serializeTerm({ type: 'literal', value: 'hi', lang: 'en' })).toBe('"hi"@en');
    expect(
      serializeTerm({ type: 'literal', value: '5', datatype: 'http://www.w3.org/2001/XMLSchema#integer' })
    ).toBe('"5"^^<http://www.w3.org/2001/XMLSchema#integer>');
  });

  it('drops the redundant xsd:string datatype', () => {
    expect(
      serializeTerm({ type: 'literal', value: 'x', datatype: 'http://www.w3.org/2001/XMLSchema#string' })
    ).toBe('"x"');
  });

  it('escapes quotes, backslashes, and control characters', () => {
    expect(serializeTerm({ type: 'literal', value: 'a"b\\c\nd\te' })).toBe('"a\\"b\\\\c\\nd\\te"');
  });
});

describe('parseTermInput auto detection', () => {
  const auto = (raw: string) => parseTermInput(raw, 'auto', expand);

  it('detects full IRIs and known curies', () => {
    expect(auto('http://x.org/a')).toEqual({ type: 'uri', value: 'http://x.org/a' });
    expect(auto('ex:Thing')).toEqual({ type: 'uri', value: 'http://ex.org/Thing' });
  });

  it('leaves unknown curie-looking strings as literals', () => {
    expect(auto('nope:Thing').type).toBe('literal');
  });

  it('detects integers, decimals, booleans, dates', () => {
    expect(auto('42').datatype).toContain('integer');
    expect(auto('-3.14').datatype).toContain('decimal');
    expect(auto('true').datatype).toContain('boolean');
    expect(auto('2026-08-22').datatype).toContain('date');
  });

  it('falls back to plain string', () => {
    expect(auto('hello world')).toEqual({ type: 'literal', value: 'hello world' });
  });

  it('forced kinds override detection', () => {
    expect(parseTermInput('42', 'string', expand)).toEqual({ type: 'literal', value: '42' });
    expect(parseTermInput('ex:A', 'iri', expand)).toEqual({ type: 'uri', value: 'http://ex.org/A' });
    expect(parseTermInput('7', 'decimal', expand).datatype).toContain('decimal');
  });

  it('trims whitespace', () => {
    expect(auto('  42  ').value).toBe('42');
  });
});
