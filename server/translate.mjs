// Pure SQL→RDF translation logic (no I/O) — schema to ontology + SHACL shapes,
// rows to N-Triples. Extracted for testability; server/index.mjs wires it to
// SQLite and Oxigraph.

export const XSD = 'http://www.w3.org/2001/XMLSchema#';
export const SH = 'http://www.w3.org/ns/shacl#';
export const RDF_ = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';

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
    t(cls, `<${RDFS}label>`, `"${escLit(table.name)}"`);
    t(shape, `<${RDF_}type>`, `<${SH}NodeShape>`);
    t(shape, `<${SH}targetClass>`, cls);
    const fkByCol = new Map(table.fks.map((f) => [f.from, f]));
    table.columns.forEach((col, i) => {
      const fk = fkByCol.get(col.name);
      const prop = `<${propIri(ns, table.name, col.name)}>`;
      const ps = `<${classIri(ns, table.name)}Shape-p-${sane(col.name)}>`;
      t(prop, `<${RDF_}type>`, `<${RDF_}Property>`);
      t(prop, `<${RDFS}label>`, `"${escLit(col.name)}"`);
      t(prop, `<${RDFS}domain>`, cls);
      t(shape, `<${SH}property>`, ps);
      t(ps, `<${SH}path>`, prop);
      t(ps, `<${SH}name>`, `"${escLit(col.name)}"`);
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

/**
 * Convert one page of rows into N-Triples blocks (one block per row).
 * Rows must include __rowid when the table has no PK.
 */
export function rowsToBlocks(rows, info, ns) {
  const table = info.name;
  const pkCols = info.columns.filter((c) => c.pk).map((c) => c.name);
  const fkByCol = new Map(info.fks.map((f) => [f.from, f]));
  const cls = classIri(ns, table);
  const blocks = [];
  for (const row of rows) {
    const key = pkCols.length ? pkCols.map((c) => encodeURIComponent(String(row[c]))).join('_') : String(row.__rowid);
    const subj = `<${ns}${sane(table)}/${key}>`;
    const lines = [`${subj} <${RDF_}type> <${cls}> .`];
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
