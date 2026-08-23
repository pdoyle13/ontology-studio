// GraphQL-from-shapes (the VendorB pattern): SHACL node shapes ARE the
// GraphQL schema. Types come from sh:targetClass, fields from property shapes
// (sh:name/sh:path/sh:datatype/sh:class/sh:maxCount). Resolution is hybrid:
// virtual classes answer from live SQL via the KG-planned federation layer,
// meta classes answer from the graph itself.

import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLFloat,
  GraphQLBoolean,
  GraphQLList,
  graphql,
  printSchema,
} from 'graphql';
import { sparql } from './meta.mjs';

const SH = 'http://www.w3.org/ns/shacl#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

/** Read every node shape with a target class into plain rows. */
export async function readShapeCatalog(oxigraph) {
  const rows = await sparql(
    oxigraph,
    `SELECT ?shape ?target ?ps ?path ?name ?datatype ?cls ?maxCount WHERE {
      ?shape <${SH}targetClass> ?target ; <${SH}property> ?ps .
      ?ps <${SH}path> ?path .
      OPTIONAL { ?ps <${SH}name> ?name }
      OPTIONAL { ?ps <${SH}datatype> ?datatype }
      OPTIONAL { ?ps <${SH}class> ?cls }
      OPTIONAL { ?ps <${SH}maxCount> ?maxCount }
      FILTER(isIRI(?path))
    }`
  );
  const byClass = new Map();
  for (const b of rows) {
    const target = b.target.value;
    if (!byClass.has(target)) byClass.set(target, { classIri: target, fields: [] });
    const entry = byClass.get(target);
    if (entry.fields.some((f) => f.path === b.path.value)) continue;
    entry.fields.push({
      path: b.path.value,
      name: b.name?.value ?? null,
      datatype: b.datatype?.value ?? null,
      targetClass: b.cls?.value ?? null,
      maxCount: b.maxCount ? Number(b.maxCount.value) : null,
    });
  }
  return [...byClass.values()];
}

const localName = (iri) => decodeURIComponent(iri.split(/[#/]/).pop() ?? iri);

export function gqlTypeName(classIri, taken = new Set()) {
  let base = localName(classIri).replace(/[^A-Za-z0-9_]/g, '_').replace(/^([0-9])/, '_$1');
  base = base.charAt(0).toUpperCase() + base.slice(1);
  let name = base;
  let i = 2;
  while (taken.has(name)) name = `${base}${i++}`;
  taken.add(name);
  return name;
}

export function gqlFieldName(field, taken = new Set()) {
  const raw = field.name ?? localName(field.path);
  let base = raw
    .replace(/[^A-Za-z0-9_ ]/g, ' ')
    .trim()
    .split(/[\s_]+/)
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('') || 'field';
  base = base.replace(/^([0-9])/, '_$1');
  let name = base;
  let i = 2;
  while (taken.has(name)) name = `${base}${i++}`;
  taken.add(name);
  return name;
}

export function scalarFor(datatype) {
  const local = (datatype ?? '').split('#').pop();
  switch (local) {
    case 'integer':
    case 'int':
    case 'long':
    case 'nonNegativeInteger':
    case 'positiveInteger':
      return 'Int';
    case 'decimal':
    case 'float':
    case 'double':
      return 'Float';
    case 'boolean':
      return 'Boolean';
    default:
      return 'String';
  }
}

/** Pure: shape rows → schema plan {types:[{typeName, queryAll, queryOne, classIri, fields:[...]}]}. */
export function planSchema(catalog) {
  const typeNames = new Set(['Query']);
  const plan = catalog.map((c) => {
    const typeName = gqlTypeName(c.classIri, typeNames);
    const fieldNames = new Set(['_id']);
    return {
      classIri: c.classIri,
      typeName,
      queryAll: (() => {
        const base = typeName.charAt(0).toLowerCase() + typeName.slice(1);
        return base.endsWith('s') ? base : `${base}s`;
      })(),
      fields: c.fields.map((f) => ({
        ...f,
        fieldName: gqlFieldName(f, fieldNames),
        scalar: scalarFor(f.datatype),
        isList: f.maxCount === null || f.maxCount > 1,
      })),
    };
  });
  // dedupe queryAll collisions
  const seen = new Set();
  for (const t of plan) {
    let q = t.queryAll;
    let i = 2;
    while (seen.has(q)) q = `${t.queryAll}${i++}`;
    seen.add(q);
    t.queryAll = q;
  }
  return plan;
}

const SCALARS = { Int: GraphQLInt, Float: GraphQLFloat, Boolean: GraphQLBoolean, String: GraphQLString };

const castScalar = (scalar, v) => {
  if (v == null) return null;
  if (scalar === 'Int') return Number.parseInt(String(v), 10);
  if (scalar === 'Float') return Number.parseFloat(String(v));
  if (scalar === 'Boolean') return String(v) === 'true' || v === 1;
  return String(v);
};

/**
 * Build an executable schema. ctx: {oxigraph, federation} where federation
 * exposes readCatalog() and queryClass() (nulls allowed for meta-only stores).
 */
export function buildSchema(plan, ctx) {
  const typeByClass = new Map();
  const objTypes = new Map();

  const metaValues = async (iri, path) =>
    (await sparql(ctx.oxigraph, `SELECT ?v WHERE { <${iri}> <${path}> ?v } LIMIT 200`)).map((b) => b.v);

  for (const t of plan) {
    const type = new GraphQLObjectType({
      name: t.typeName,
      fields: () => {
        const fields = {
          _id: { type: GraphQLString, resolve: (p) => p.__iri ?? null },
        };
        for (const f of t.fields) {
          const targetPlan = f.targetClass ? typeByClass.get(f.targetClass) : null;
          const inner = targetPlan ? objTypes.get(targetPlan.typeName) : SCALARS[f.scalar];
          fields[f.fieldName] = {
            type: f.isList ? new GraphQLList(inner) : inner,
            resolve: async (parent) => {
              // virtual row: column values were preloaded onto the parent
              if (parent.__row) {
                const col = parent.__cols?.get(f.path);
                const v = col ? castScalar(f.scalar, parent.__row[col]) : null;
                return f.isList ? (v == null ? [] : [v]) : v;
              }
              // meta resource: resolve per-field from the graph
              const vals = await metaValues(parent.__iri, f.path);
              const mapped = targetPlan
                ? vals.filter((v) => v.type === 'uri').map((v) => ({ __iri: v.value }))
                : vals.map((v) => castScalar(f.scalar, v.value));
              return f.isList ? mapped : mapped[0] ?? null;
            },
          };
        }
        return fields;
      },
    });
    typeByClass.set(t.classIri, t);
    objTypes.set(t.typeName, type);
  }

  const queryFields = {};
  for (const t of plan) {
    queryFields[t.queryAll] = {
      type: new GraphQLList(objTypes.get(t.typeName)),
      args: { limit: { type: GraphQLInt }, offset: { type: GraphQLInt } },
      resolve: async (_p, args) => {
        const limit = Math.min(args.limit ?? 50, 500);
        const offset = args.offset ?? 0;
        // virtual class → live SQL through the federation planner
        const catalog = ctx.federation ? await ctx.federation.readCatalog() : [];
        const entry = catalog.find((c) => c.classIri === t.classIri);
        if (entry) {
          const { rows } = await ctx.federation.queryClass({ classIri: t.classIri, limit, offset, catalog });
          const cols = new Map(entry.columns.map((c) => [c.property, c.column]));
          return rows.map((r) => ({ __row: r, __cols: cols, __iri: r.__iri ?? null }));
        }
        // meta class → instances from the graph (with subclass closure)
        const rows = await sparql(
          ctx.oxigraph,
          `SELECT DISTINCT ?s WHERE { ?s a/<http://www.w3.org/2000/01/rdf-schema#subClassOf>* <${t.classIri}> . FILTER(isIRI(?s)) } ORDER BY ?s LIMIT ${limit} OFFSET ${offset}`
        );
        return rows.map((b) => ({ __iri: b.s.value }));
      },
    };
  }

  return new GraphQLSchema({ query: new GraphQLObjectType({ name: 'Query', fields: queryFields }) });
}

/** Convenience: full pipeline with memoization handled by the caller. */
export async function createGraphQL(ctx) {
  const catalog = await readShapeCatalog(ctx.oxigraph);
  const plan = planSchema(catalog);
  const schema = buildSchema(plan, ctx);
  return {
    schema,
    sdl: printSchema(schema),
    execute: (source, variableValues) => graphql({ schema, source, variableValues }),
  };
}
