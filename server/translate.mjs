// Pure SQL→RDF translation logic (no I/O) — schema to ontology + SHACL shapes,
// rows to N-Triples. Extracted for testability; server/index.mjs wires it to
// SQLite and Oxigraph.

export const XSD = 'http://www.w3.org/2001/XMLSchema#';
export const SH = 'http://www.w3.org/ns/shacl#';
export const RDF_ = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
export const DASH = 'http://datashapes.org/dash#';

export function sqlTypeToXsd(type) {
  const t = String(type).toUpperCase();
  if (/INT/.test(t)) return `${XSD}integer`;
  if (/REAL|FLOA|DOUB|NUMERIC|DECIMAL/.test(t)) return `${XSD}decimal`;
  if (/BOOL/.test(t)) return `${XSD}boolean`;
  if (/DATETIME|TIMESTAMP/.test(t)) return `${XSD}dateTime`;
  if (/DATE/.test(t)) return `${XSD}date`;
  if (/BLOB/.test(t)) return null; // skipped
  return `${XSD}string`;
}

export const sane = (s) => String(s).replace(/[^\w-]/g, '_');

/** snake_case / camelCase identifier → "Title Case" human label. */
export function humanize(s) {
  return String(s)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/** Pick the column whose values best serve as instance labels. */
export function pickLabelColumn(info) {
  const cols = info.columns;
  const fkCols = new Set(info.fks.map((f) => f.from));
  const byName = (re) => cols.find((c) => re.test(c.name) && !fkCols.has(c.name));
  return (
    byName(/^(name|title|label|full_name|display_name)$/i) ??
    byName(/(_name|_title|_label)$/i) ??
    byName(/^(event|status|code|email|order_number|tracking_no|username)$/i) ??
    cols.find((c) => /TEXT|CHAR|CLOB/i.test(c.type) && !fkCols.has(c.name) && !c.pk) ??
    null
  );
}
export const classIri = (ns, table) => `${ns}${sane(table)}`;
export const propIri = (ns, table, col) => `${ns}${sane(table)}_${sane(col)}`;
export const escLit = (v) =>
  String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');

export const isReadOnlySql = (sql) => /^(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(String(sql).trim());

/** Generate ontology + SHACL shapes for a schema (introspection JSON) as N-Triples. */
export function translateSchema(schema, ns) {
  const out = [];
  const t = (s, p, o) => out.push(`${s} ${p} ${o} .`);
  for (const table of schema) {
    const cls = `<${classIri(ns, table.name)}>`;
    const shape = `<${classIri(ns, table.name)}Shape>`;
    t(cls, `<${RDF_}type>`, `<${RDFS}Class>`);
    t(cls, `<${RDFS}label>`, `"${escLit(humanize(table.name))}"`);
    t(shape, `<${RDF_}type>`, `<${SH}NodeShape>`);
    t(shape, `<${SH}targetClass>`, cls);
    const fkByCol = new Map(table.fks.map((f) => [f.from, f]));
    const labelCol = pickLabelColumn(table);
    table.columns.forEach((col, i) => {
      const fk = fkByCol.get(col.name);
      const prop = `<${propIri(ns, table.name, col.name)}>`;
      const ps = `<${classIri(ns, table.name)}Shape-p-${sane(col.name)}>`;
      // the shape DESIGNATES the label property (dash:LabelRole) — no rdfs:label fabrication on instances
      if (labelCol && col.name === labelCol.name) t(ps, `<${DASH}propertyRole>`, `<${DASH}LabelRole>`);
      t(prop, `<${RDF_}type>`, `<${RDF_}Property>`);
      t(prop, `<${RDFS}label>`, `"${escLit(humanize(col.name))}"`);
      t(prop, `<${RDFS}domain>`, cls);
      t(shape, `<${SH}property>`, ps);
      t(ps, `<${SH}path>`, prop);
      t(ps, `<${SH}name>`, `"${escLit(humanize(col.name))}"`);
      t(ps, `<${SH}order>`, `"${i + 1}"^^<${XSD}integer>`);
      t(ps, `<${SH}maxCount>`, `"1"^^<${XSD}integer>`);
      if (col.notnull || col.pk) t(ps, `<${SH}minCount>`, `"1"^^<${XSD}integer>`);
      if (fk) {
        const target = `<${classIri(ns, fk.table)}>`;
        t(prop, `<${RDFS}range>`, target);
        t(ps, `<${SH}class>`, target);
        t(ps, `<${SH}nodeKind>`, `<${SH}IRI>`);
      } else {
        const dt = sqlTypeToXsd(col.type);
        if (dt) {
          t(prop, `<${RDFS}range>`, `<${dt}>`);
          t(ps, `<${SH}datatype>`, `<${dt}>`);
        }
      }
    });
  }
  return out.join('\n');
}

export const STUDIO_NS = 'https://studio.local/ns#';

/**
 * Convert one page of rows into N-Triples blocks (one block per row).
 * Rows must include __rowid when the table has no PK.
 * provenance.sourceIri stamps each instance with the database it came from.
 */
export function rowsToBlocks(rows, info, ns, provenance = null) {
  const table = info.name;
  const pkCols = info.columns.filter((c) => c.pk).map((c) => c.name);
  const fkByCol = new Map(info.fks.map((f) => [f.from, f]));
  const cls = classIri(ns, table);
  const blocks = [];
  for (const row of rows) {
    const key = pkCols.length ? pkCols.map((c) => encodeURIComponent(String(row[c]))).join('_') : String(row.__rowid);
    const subj = `<${ns}${sane(table)}/${key}>`;
    const lines = [`${subj} <${RDF_}type> <${cls}> .`];
    if (provenance?.sourceIri) {
      lines.push(`${subj} <${STUDIO_NS}fromSource> <${provenance.sourceIri}> .`);
      lines.push(`${subj} <${STUDIO_NS}sourceTable> "${escLit(table)}" .`);
    }
    for (const col of info.columns) {
      const v = row[col.name];
      if (v === null || v === undefined) continue;
      const fk = fkByCol.get(col.name);
      const prop = `<${propIri(ns, table, col.name)}>`;
      if (fk) {
        lines.push(`${subj} ${prop} <${ns}${sane(fk.table)}/${encodeURIComponent(String(v))}> .`);
      } else {
        const dt = sqlTypeToXsd(col.type);
        if (!dt) continue;
        if (dt === `${XSD}string`) lines.push(`${subj} ${prop} "${escLit(v)}" .`);
        else if (dt === `${XSD}boolean`) lines.push(`${subj} ${prop} "${v ? 'true' : 'false'}"^^<${dt}> .`);
        else lines.push(`${subj} ${prop} "${escLit(v)}"^^<${dt}> .`);
      }
    }
    blocks.push(lines.join('\n'));
  }
  return blocks;
}
