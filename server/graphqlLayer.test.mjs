import { describe, it, expect } from 'vitest';
import { planSchema, gqlTypeName, gqlFieldName, scalarFor, buildSchema } from './graphqlLayer.mjs';
import { graphql } from 'graphql';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

describe('naming', () => {
  it('type names are PascalCase local names, deduped', () => {
    const taken = new Set();
    expect(gqlTypeName('https://a/sql/sales_db#orders', taken)).toBe('Orders');
    expect(gqlTypeName('https://b/other#orders', taken)).toBe('Orders2');
    expect(gqlTypeName('https://c/x#123weird-name', taken)).toBe('_123weird_name');
  });

  it('field names camelCase sh:name, fall back to path local name', () => {
    const taken = new Set();
    expect(gqlFieldName({ name: 'Order Number', path: 'p:x' }, taken)).toBe('orderNumber');
    expect(gqlFieldName({ name: null, path: 'https://p#ship_date' }, taken)).toBe('shipDate');
    expect(gqlFieldName({ name: 'Order Number', path: 'p:y' }, taken)).toBe('orderNumber2');
  });

  it('scalar mapping', () => {
    expect(scalarFor(`${XSD}integer`)).toBe('Int');
    expect(scalarFor(`${XSD}decimal`)).toBe('Float');
    expect(scalarFor(`${XSD}boolean`)).toBe('Boolean');
    expect(scalarFor(`${XSD}string`)).toBe('String');
    expect(scalarFor(null)).toBe('String');
  });
});

describe('planSchema', () => {
  const catalog = [
    {
      classIri: 'https://x#Order',
      fields: [
        { path: 'https://x#number', name: 'Number', datatype: `${XSD}string`, targetClass: null, maxCount: 1 },
        { path: 'https://x#items', name: null, datatype: null, targetClass: 'https://x#Item', maxCount: null },
      ],
    },
    { classIri: 'https://x#Item', fields: [{ path: 'https://x#sku', name: null, datatype: `${XSD}string`, targetClass: null, maxCount: 1 }] },
  ];

  it('plans types, list queries, and cardinality', () => {
    const plan = planSchema(catalog);
    expect(plan[0].typeName).toBe('Order');
    expect(plan[0].queryAll).toBe('orders');
    expect(planSchema([{ classIri: 'https://x#shipments', fields: [] }])[0].queryAll).toBe('shipments');
    expect(plan[0].fields[0].isList).toBe(false);
    expect(plan[0].fields[1].isList).toBe(true);
    expect(plan[1].queryAll).toBe('items');
  });

  it('builds an executable schema that resolves virtual rows', async () => {
    const plan = planSchema(catalog);
    const fedCatalog = [
      {
        classIri: 'https://x#Order',
        sourceId: 'db1',
        table: 'orders',
        subjectTemplate: 'https://x#Order/{id}',
        columns: [{ column: 'number', property: 'https://x#number', datatype: null }],
        refs: [],
      },
    ];
    const federation = {
      readCatalog: async () => fedCatalog,
      queryClass: async () => ({ rows: [{ __iri: 'https://x#Order/1', number: 'ORD-1' }] }),
    };
    const schema = buildSchema(plan, { oxigraph: 'http://unused', federation });
    const r = await graphql({ schema, source: '{ orders(limit: 5) { _id number } }' });
    expect(r.errors).toBeUndefined();
    expect(r.data.orders).toEqual([{ _id: 'https://x#Order/1', number: 'ORD-1' }]);
  });
});
