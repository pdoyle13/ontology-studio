// Federated data access, planned FROM the knowledge graph.
// The R2RML mappings graph is the catalog: class → TriplesMap → logical table +
// column/property maps + owning source. Given target classes, the planner
// determines which databases to query; execution dispatches live SQL through
// the per-source drivers. No structure is hardcoded — it all comes from RDF.

import { MAPPINGS_GRAPH, STUDIO } from './r2rml.mjs';
import { sparql } from '../core/meta.mjs';

const RR = 'http://www.w3.org/ns/r2rml#';
const PROV = 'http://www.w3.org/ns/prov#';


/**
 * Read the data catalog out of the mappings graph.
 * Returns: [{ classIri, sourceId, table, subjectTemplate,
 *             columns: [{column, property, datatype}],
 *             refs: [{column, property, template}] }]
 */
export async function readCatalog(oxigraph, liveSourceIds) {
  const rows = await sparql(
    oxigraph,
    `SELECT ?tm ?src ?cls ?table ?template ?pred ?col ?dt ?objTemplate WHERE {
  GRAPH <${MAPPINGS_GRAPH}> {
    ?tm <${RR}logicalTable> ?lt . ?lt <${RR}tableName> ?table .
    ?tm <${RR}subjectMap> ?sm . ?sm <${RR}template> ?template ; <${RR}class> ?cls .
    ?tm <${PROV}wasDerivedFrom> ?src .
    ?tm <${RR}predicateObjectMap> ?pom .
    ?pom <${RR}predicate> ?pred ; <${RR}objectMap> ?om .
    OPTIONAL { ?om <${RR}column> ?col }
    OPTIONAL { ?om <${RR}datatype> ?dt }
    OPTIONAL { ?om <${RR}template> ?objTemplate }
  }
}`
  );
  const byTm = new Map();
  for (const b of rows) {
    const sourceId = b.src.value.replace(`${STUDIO}source/`, '');
    if (liveSourceIds && !liveSourceIds.has(sourceId)) continue; // stale mappings for detached sources
    const key = b.tm.value;
    if (!byTm.has(key)) {
      byTm.set(key, {
        classIri: b.cls.value,
        sourceId,
        table: b.table.value,
        subjectTemplate: b.template.value,
        columns: [],
        refs: [],
      });
    }
    const e = byTm.get(key);
    if (b.col && !e.columns.some((c) => c.column === b.col.value)) {
      e.columns.push({ column: b.col.value, property: b.pred.value, datatype: b.dt?.value ?? null });
    } else if (b.objTemplate && !e.refs.some((r) => r.property === b.pred.value)) {
      const m = b.objTemplate.value.match(/\{([^}]+)\}/);
      e.refs.push({ column: m ? m[1] : null, property: b.pred.value, template: b.objTemplate.value });
    }
  }
  return [...byTm.values()];
}

/** Which databases does a request over these classes touch? */
export function planSources(catalog, classIris) {
  const wanted = new Set(classIris);
  const hits = catalog.filter((c) => wanted.has(c.classIri));
  const bySource = new Map();
  for (const h of hits) {
    if (!bySource.has(h.sourceId)) bySource.set(h.sourceId, []);
    bySource.get(h.sourceId).push({ classIri: h.classIri, table: h.table });
  }
  return [...bySource.entries()].map(([sourceId, targets]) => ({ sourceId, targets }));
}

const OPS = new Set(['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'ILIKE']);
const sqlLit = (v) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

/**
 * Build a guarded SELECT for one catalog entry.
 * columns: subset of mapped columns (default all). filters: [{column, op, value}].
 */
export function buildSelect(entry, { columns, filters, limit, orderBy, offset } = {}) {
  const known = new Set([...entry.columns.map((c) => c.column), ...entry.refs.map((r) => r.column).filter(Boolean)]);
  const cols =
    columns && columns.length
      ? columns.filter((c) => known.has(c))
      : [...known];
  if (cols.length === 0) throw new Error(`no known columns requested for ${entry.table} (known: ${[...known].join(', ')})`);
  const where = (filters ?? [])
    .map((f) => {
      if (!known.has(f.column)) throw new Error(`unknown column ${f.column} on ${entry.table}`);
      const op = String(f.op ?? '=').toUpperCase();
      if (!OPS.has(op)) throw new Error(`unsupported operator ${f.op}`);
      // portable case-insensitive match: engines disagree on LIKE case rules
      if (op === 'ILIKE') return `LOWER("${f.column}") LIKE ${sqlLit(String(f.value).toLowerCase())}`;
      return `"${f.column}" ${op} ${sqlLit(f.value)}`;
    })
    .join(' AND ');
  let order = '';
  if (orderBy?.column) {
    if (!known.has(orderBy.column)) throw new Error(`unknown sort column ${orderBy.column}`);
    const dir = String(orderBy.dir ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    order = ` ORDER BY "${orderBy.column}" ${dir}`;
  }
  const n = Math.min(Number(limit) > 0 ? Number(limit) : 200, 1000);
  const off = Number(offset) > 0 ? ` OFFSET ${Math.floor(Number(offset))}` : '';
  return `SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${entry.table}"${where ? ` WHERE ${where}` : ''}${order} LIMIT ${n}${off}`;
}

/** Mint the subject IRI for a row using the R2RML subject template. */
export function mintSubject(entry, row) {
  return entry.subjectTemplate.replace(/\{([^}]+)\}/g, (_, col) => encodeURIComponent(String(row[col] ?? '')));
}

/**
 * Federated fetch: resolve the class in the catalog, pick the owning database,
 * run live SQL there. Returns rows + full provenance of where they came from.
 */
export async function queryClass({ oxigraph, drivers, classIri, columns, filters, limit, orderBy, offset, catalog: presupplied }) {
  const catalog = presupplied ?? (await readCatalog(oxigraph, new Set(drivers.keys())));
  const entry = catalog.find((c) => c.classIri === classIri);
  if (!entry) {
    const known = catalog.map((c) => c.classIri);
    throw new Error(`class not in catalog: ${classIri}. Known: ${known.join(', ') || '(none — translate a schema first)'}`);
  }
  const driver = drivers.get(entry.sourceId);
  if (!driver) throw new Error(`source ${entry.sourceId} is not attached`);
  const sql = buildSelect(entry, { columns, filters, limit, orderBy, offset });
  const rows = await driver.query(sql);
  return {
    classIri,
    source: { id: entry.sourceId, kind: driver.kind },
    table: entry.table,
    sql,
    rows: rows.map((r) => ({ __iri: mintSubject(entry, r), ...r })),
  };
}
