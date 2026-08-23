import { describe, it, expect } from 'vitest';
import { compileRule, INFERRED_GRAPH } from './rules.mjs';

const SH = 'http://www.w3.org/ns/shacl#';

describe('compileRule', () => {
  it('triple rule: sh:this subject, IRI object, subclass closure', () => {
    const q = compileRule({
      kind: 'triple',
      targetClass: 'https://x#Album',
      subject: `${SH}this`,
      predicate: 'https://x#mediaType',
      object: { value: 'https://x#Recording', isIri: true },
    });
    expect(q).toContain('CONSTRUCT { ?this <https://x#mediaType> <https://x#Recording> }');
    expect(q).toContain('subClassOf>* <https://x#Album>');
    expect(q).toContain('FILTER(isIRI(?this))');
  });

  it('triple rule: literal object with datatype, escaped quotes', () => {
    const q = compileRule({
      kind: 'triple',
      targetClass: 'https://x#C',
      subject: null,
      predicate: 'https://x#status',
      object: { value: 'said "hi"', isIri: false, datatype: 'http://www.w3.org/2001/XMLSchema#string' },
    });
    expect(q).toContain('"said \\"hi\\""');
    expect(q).not.toContain('^^'); // plain xsd:string stays plain
  });

  it('sparql rule: $this normalized and bound to the target class', () => {
    const q = compileRule({
      kind: 'sparql',
      targetClass: 'https://x#Order',
      construct: 'CONSTRUCT { $this <https://x#late> true } WHERE { $this <https://x#due> ?d . FILTER(?d < NOW()) }',
    });
    expect(q).toContain('?this a/<http://www.w3.org/2000/01/rdf-schema#subClassOf>* <https://x#Order>');
    expect(q).not.toContain('$this');
  });

  it('sparql rule without target class runs verbatim', () => {
    const src = 'CONSTRUCT { ?a <https://x#peer> ?b } WHERE { ?a <https://x#knows> ?b }';
    expect(compileRule({ kind: 'sparql', targetClass: null, construct: src })).toBe(src);
  });

  it('incomplete rules compile to null', () => {
    expect(compileRule({ kind: 'triple', targetClass: null, predicate: 'p', object: { value: 'x', isIri: true } })).toBeNull();
    expect(compileRule({ kind: 'triple', targetClass: 'c', predicate: null, object: null })).toBeNull();
    expect(compileRule({ kind: 'sparql', construct: null })).toBeNull();
  });

  it('inferred graph IRI is stable', () => {
    expect(INFERRED_GRAPH).toBe('https://studio.local/graphs/inferred');
  });
});
