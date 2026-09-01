// Generic spreadsheet import for class-based asset types: reuses the CSV
// parse + header mapping from the taxonomy importer, adds class-instance
// validation/building and saved mapping templates (stored in the extensions
// graph, keyed by class). Pure stages, all unit-testable.

import type { Endpoint } from './sparqlClient';
import { select, update } from './sparqlClient';
import type { PropertyShapeInfo } from './shacl';
import { validateAgainstShape } from './constraints';
import { serializeTerm } from './mutations';
import { useHistory } from '../state/history';
import { EXT_GRAPH, slug } from './skosExt';
import type { ColumnMap } from './csvImport';

const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const STUDIO = 'https://studio.local/ns#';

/** A label pseudo-field so spreadsheets can map a Label column explicitly. */
export function labelField(): PropertyShapeInfo {
  return {
    shapeIri: '',
    path: RDFS_LABEL,
    name: 'Label',
    description: null,
    codelist: null,
    datatype: 'http://www.w3.org/2001/XMLSchema#string',
    classIri: null,
    nodeKind: null,
    minCount: 1,
    maxCount: 1,
    order: 0,
    minInclusive: null,
    maxInclusive: null,
    pattern: null,
    singleLine: null,
    maxLength: null,
    inValues: null,
  };
}

export interface ClassRowReport {
  index: number;
  label: string;
  iri: string;
  errors: string[];
}

export function validateClassRows(
  dataRows: string[][],
  map: ColumnMap,
  opts: { classIri: string; existingLabels: Set<string> }
): ClassRowReport[] {
  const labelCol = map.columns.findIndex((f) => f?.path === RDFS_LABEL);
  const ns = opts.classIri.replace(/[^#/]+$/, '');
  const seen = new Map<string, number>();
  const existing = new Set([...opts.existingLabels].map((l) => l.trim().toLowerCase()));

  return dataRows.map((cells, index) => {
    const errors: string[] = [];
    const label = (labelCol >= 0 ? cells[labelCol] ?? '' : '').trim();
    if (!label) errors.push('missing label');
    const key = label.toLowerCase();
    if (label && seen.has(key)) errors.push(`duplicate of row ${seen.get(key)! + 1}`);
    if (label && existing.has(key)) errors.push('an instance with this label already exists');

    map.columns.forEach((f, ci) => {
      const raw = (cells[ci] ?? '').trim();
      if (!f || !raw || f.path === RDFS_LABEL) return;
      const parts = f.maxCount === null ? raw.split('|') : [raw];
      for (const part of parts) {
        const err = part.trim() ? validateAgainstShape(f, part.trim()) : null;
        if (err) errors.push(`${f.name ?? 'column'}: ${err}`);
      }
    });

    if (label && errors.length === 0) seen.set(key, index);
    return { index, label, iri: `${ns}${slug(label || `row-${index}`)}`, errors };
  });
}

export function buildClassTriples(
  dataRows: string[][],
  map: ColumnMap,
  reports: ClassRowReport[],
  opts: { classIri: string }
): { triples: string[]; imported: number } {
  const triples: string[] = [];
  let imported = 0;
  for (const rep of reports) {
    if (rep.errors.length || !rep.label) continue;
    const cells = dataRows[rep.index];
    triples.push(`<${rep.iri}> <${RDF_TYPE}> <${opts.classIri}> .`);
    triples.push(`<${rep.iri}> <${RDFS_LABEL}> ${serializeTerm({ type: 'literal', value: rep.label })} .`);
    map.columns.forEach((f, ci) => {
      const raw = (cells[ci] ?? '').trim();
      if (!f || !raw || f.path === RDFS_LABEL) return;
      const parts = f.maxCount === null ? raw.split('|').map((x) => x.trim()).filter(Boolean) : [raw.trim()];
      for (const v of parts) {
        const dt = f.datatype && f.datatype !== 'http://www.w3.org/2001/XMLSchema#string' ? f.datatype : undefined;
        triples.push(`<${rep.iri}> <${f.path}> ${serializeTerm({ type: 'literal', value: v, datatype: dt })} .`);
      }
    });
    imported++;
  }
  return { triples, imported };
}

export async function cmdImportInstances(ep: Endpoint, graph: string | null, triples: string[], count: number): Promise<void> {
  const block = triples.join('\n');
  const wrap = (t: string) => (graph ? `GRAPH <${graph}> { ${t} }` : t);
  await useHistory.getState().exec({
    label: `import ${count} instances`,
    redo: () => update(ep, `INSERT DATA { ${wrap(block)} }`),
    undo: () => update(ep, `DELETE DATA { ${wrap(block)} }`),
  });
}

// ---------- saved mapping templates ----------

/** header text → field path ('' = ignore). Stored as a JSON literal per class. */
export type MappingTemplate = Record<string, string>;

const templateIri = (classIri: string) => `${STUDIO}importTemplate/${slug(classIri.split(/[#/]/).pop() ?? 'class')}-${Math.abs(hash(classIri))}`;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

export async function saveTemplate(ep: Endpoint, classIri: string, mapping: MappingTemplate): Promise<void> {
  const iri = templateIri(classIri);
  const body = serializeTerm({ type: 'literal', value: JSON.stringify(mapping) });
  await update(
    ep,
    `DELETE WHERE { GRAPH <${EXT_GRAPH}> { <${iri}> ?p ?o } } ;
     INSERT DATA { GRAPH <${EXT_GRAPH}> {
       <${iri}> a <${STUDIO}ImportTemplate> .
       <${iri}> <${STUDIO}forClass> <${classIri}> .
       <${iri}> <${STUDIO}mapping> ${body} .
     } }`
  );
}

export async function loadTemplate(ep: Endpoint, classIri: string): Promise<MappingTemplate | null> {
  try {
    const r = await select(
      ep,
      `SELECT ?m WHERE { GRAPH <${EXT_GRAPH}> { ?t a <${STUDIO}ImportTemplate> ; <${STUDIO}forClass> <${classIri}> ; <${STUDIO}mapping> ?m } } LIMIT 1`
    );
    const raw = r.bindings[0]?.m?.value;
    return raw ? (JSON.parse(raw) as MappingTemplate) : null;
  } catch {
    return null;
  }
}

/** Apply a template on top of auto-mapping: template wins per header. */
export function applyTemplate(headers: string[], map: ColumnMap, fields: PropertyShapeInfo[], tpl: MappingTemplate | null): ColumnMap {
  if (!tpl) return map;
  const byPath = new Map(fields.map((f) => [f.path, f]));
  const columns = map.columns.map((auto, i) => {
    const want = tpl[headers[i]?.trim() ?? ''];
    if (want === undefined) return auto;
    if (want === '') return null;
    return byPath.get(want) ?? auto;
  });
  return { ...map, columns, prefixCol: undefined as never, prefCol: columns.findIndex((f) => f?.path === RDFS_LABEL) } as ColumnMap;
}
