import { describe, it, expect } from 'vitest';
import { slug, builtinFields, buildConceptTriples } from './skosExt';

const SKOS = 'http://www.w3.org/2004/02/skos/core#';

describe('slug', () => {
  it('kebab-cases labels', () => {
    expect(slug('Data Platforms')).toBe('data-platforms');
    expect(slug('  C++ & Rust!  ')).toBe('c-rust');
    expect(slug('###')).toBe('field');
  });
});

describe('builtinFields', () => {
  it('concept fields: prefLabel required, altLabel multi, definition long', () => {
    const f = builtinFields('concept');
    const pref = f.find((x) => x.path === `${SKOS}prefLabel`)!;
    const alt = f.find((x) => x.path === `${SKOS}altLabel`)!;
    const def = f.find((x) => x.path === `${SKOS}definition`)!;
    expect(pref.minCount).toBe(1);
    expect(alt.maxCount).toBeNull();
    expect(def.singleLine).toBe(false);
  });

  it('scheme fields: name required', () => {
    const f = builtinFields('scheme');
    expect(f.find((x) => x.path === `${SKOS}prefLabel`)!.minCount).toBe(1);
  });
});

describe('buildConceptTriples', () => {
  const fields = builtinFields('concept');

  it('emits type, scheme membership, and topConceptOf for roots', () => {
    const t = buildConceptTriples(
      { iri: 'c:x', scheme: 's:t', broader: null, values: new Map([[`${SKOS}prefLabel`, ['Widgets']]]) },
      fields
    );
    expect(t).toContain(`<c:x> a <${SKOS}Concept> .`);
    expect(t).toContain(`<c:x> <${SKOS}topConceptOf> <s:t> .`);
    expect(t).toContain(`<c:x> <${SKOS}prefLabel> "Widgets" .`);
    expect(t.join('\n')).not.toContain('broader');
  });

  it('emits broader instead of topConceptOf for children', () => {
    const t = buildConceptTriples(
      { iri: 'c:x', scheme: 's:t', broader: 'c:parent', values: new Map() },
      fields
    );
    expect(t).toContain(`<c:x> <${SKOS}broader> <c:parent> .`);
    expect(t.join('\n')).not.toContain('topConceptOf');
  });

  it('emits one triple per multi-value entry and skips blanks', () => {
    const t = buildConceptTriples(
      { iri: 'c:x', scheme: 's:t', values: new Map([[`${SKOS}altLabel`, ['Gadgets', ' ', 'Doohickeys']]]) },
      fields
    );
    expect(t.filter((x) => x.includes('altLabel'))).toHaveLength(2);
  });

  it('applies custom field datatypes and escapes quotes', () => {
    const custom = [
      { ...fields[0], path: 'https://studio.local/vocab/review-date', datatype: 'http://www.w3.org/2001/XMLSchema#date' },
    ];
    const t = buildConceptTriples(
      {
        iri: 'c:x',
        scheme: 's:t',
        values: new Map([
          ['https://studio.local/vocab/review-date', ['2026-09-01']],
          [`${SKOS}definition`, ['He said "hi".']],
        ]),
      },
      [...fields, ...custom]
    );
    expect(t).toContain('<c:x> <https://studio.local/vocab/review-date> "2026-09-01"^^<http://www.w3.org/2001/XMLSchema#date> .');
    expect(t.join('\n')).toContain('\\"hi\\"');
  });
});
