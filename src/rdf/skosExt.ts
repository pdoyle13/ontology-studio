// Taxonomy extensions: custom fields for SKOS assets are themselves SHACL
// property shapes on a well-known NodeShape per asset type, stored in the
// dedicated extensions graph. Nothing is hardcoded downstream — the create
// dialog, validation, and (later) CSV import all read the same shapes.

import type { Endpoint } from './sparqlClient';
import { SH, DASH } from './vocab';
import { select, update } from './sparqlClient';
import { serializeTerm } from './mutations';
import { useHistory } from '../state/history';
import type { PropertyShapeInfo } from './shacl';
import { SKOS } from './skos';

export const EXT_GRAPH = 'https://studio.local/graphs/extensions';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const STUDIO_VOCAB = 'https://studio.local/vocab/';

export type AssetType = 'concept' | 'scheme';

export const ASSET_CLASS: Record<AssetType, string> = {
  concept: `${SKOS}Concept`,
  scheme: `${SKOS}ConceptScheme`,
};

const ASSET_SHAPE: Record<AssetType, string> = {
  concept: 'https://studio.local/shapes/ext/ConceptShape',
  scheme: 'https://studio.local/shapes/ext/SchemeShape',
};

export function slug(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'field';
}

/** Field kinds offered in the extensions configurator. */
export type FieldKind = 'text' | 'multiline' | 'langtext' | 'number' | 'date' | 'boolean' | 'enum' | 'codelist';

export interface CustomFieldSpec {
  label: string;
  kind: FieldKind;
  required: boolean;
  description?: string;
  options?: string[]; // enum only
  codelist?: string; // codelist only — concept scheme IRI providing the codes
  /** Reuse an existing predicate (e.g. skos:editorialNote); default mints studio.local/vocab/<slug>. */
  path?: string;
}

const KIND_DATATYPE: Record<FieldKind, string | null> = {
  text: `${XSD}string`,
  multiline: `${XSD}string`,
  langtext: `${RDF_NS}langString`,
  number: `${XSD}decimal`,
  date: `${XSD}date`,
  boolean: `${XSD}boolean`,
  enum: `${XSD}string`,
  codelist: `${XSD}string`,
};

/** The built-in SKOS fields every concept dialog shows (shape-shaped so widgets work). */
export function builtinFields(asset: AssetType): PropertyShapeInfo[] {
  const base = (over: Partial<PropertyShapeInfo>): PropertyShapeInfo => ({
    shapeIri: ASSET_SHAPE[asset],
    path: '',
    name: null,
    description: null,
    datatype: `${XSD}string`,
    classIri: null,
    nodeKind: null,
    minCount: null,
    maxCount: 1,
    order: 0,
    minInclusive: null,
    maxInclusive: null,
    pattern: null,
    singleLine: null,
    maxLength: null,
    inValues: null,
    ...over,
  });
  if (asset === 'scheme') {
    return [
      base({ path: `${SKOS}prefLabel`, name: 'Name', minCount: 1, order: 1 }),
      base({ path: `${SKOS}definition`, name: 'Description', singleLine: false, order: 2, description: 'What this scheme covers.' }),
    ];
  }
  return [
    base({ path: `${SKOS}prefLabel`, name: 'Preferred label', minCount: 1, order: 1 }),
    base({ path: `${SKOS}altLabel`, name: 'Alternative labels', maxCount: null, order: 2, description: 'Synonyms — separate with | (pipe).' }),
    base({ path: `${SKOS}definition`, name: 'Definition', singleLine: false, order: 3 }),
    base({ path: `${SKOS}notation`, name: 'Notation', order: 4, description: 'Code or identifier, e.g. 510.3.' }),
  ];
}

/** Custom fields configured for an asset type, read from the extensions graph. */
export async function fetchCustomFields(ep: Endpoint, asset: AssetType): Promise<PropertyShapeInfo[]> {
  const shape = ASSET_SHAPE[asset];
  const q = `
SELECT ?ps ?path ?name ?desc ?datatype ?minCount ?singleLine ?order ?cell ?inVal ?codelist (COUNT(?mid) AS ?depth) WHERE {
  GRAPH <${EXT_GRAPH}> {
    <${shape}> <${SH.property}> ?ps .
    ?ps <${SH.path}> ?path .
    OPTIONAL { ?ps <${SH.name}> ?name }
    OPTIONAL { ?ps <${SH.description}> ?desc }
    OPTIONAL { ?ps <${SH.datatype}> ?datatype }
    OPTIONAL { ?ps <${SH.minCount}> ?minCount }
    OPTIONAL { ?ps <${DASH.singleLine}> ?singleLine }
    OPTIONAL { ?ps <${SH.order}> ?order }
    OPTIONAL { ?ps <https://studio.local/ns#codelist> ?codelist }
    OPTIONAL {
      ?ps <${SH.in}> ?list .
      ?list <${RDF_NS}rest>* ?cell .
      ?cell <${RDF_NS}first> ?inVal .
      ?list <${RDF_NS}rest>* ?mid .
      ?mid <${RDF_NS}rest>* ?cell .
    }
  }
}
GROUP BY ?ps ?path ?name ?desc ?datatype ?minCount ?singleLine ?order ?cell ?inVal ?codelist
ORDER BY ?order ?ps ?depth`;
  const r = await select(ep, q);
  const byPs = new Map<string, PropertyShapeInfo>();
  for (const b of r.bindings) {
    if (!b.ps || !b.path) continue;
    const key = b.ps.value;
    if (!byPs.has(key)) {
      byPs.set(key, {
        shapeIri: ASSET_SHAPE[asset],
        path: b.path.value,
        name: b.name?.value ?? null,
        description: b.desc?.value ?? null,
        datatype: b.datatype?.value ?? null,
        classIri: null,
        nodeKind: null,
        minCount: b.minCount ? Number(b.minCount.value) : null,
        maxCount: 1,
        order: b.order ? Number(b.order.value) : 100,
        minInclusive: null,
        maxInclusive: null,
        pattern: null,
        singleLine: b.singleLine ? b.singleLine.value === 'true' : null,
        codelist: b.codelist?.value ?? null,
        maxLength: null,
        inValues: null,
      });
    }
    if (b.inVal) {
      const ps = byPs.get(key)!;
      ps.inValues = ps.inValues ?? [];
      ps.inValues.push({ value: b.inVal.value, isIri: b.inVal.type === 'uri' });
    }
  }
  return [...byPs.values()].sort((a, b) => a.order - b.order);
}

export async function fetchAssetFields(ep: Endpoint, asset: AssetType): Promise<PropertyShapeInfo[]> {
  const custom = await fetchCustomFields(ep, asset).catch(() => []);
  return [...builtinFields(asset), ...custom];
}

const lit = (v: string) => serializeTerm({ type: 'literal', value: v });

/** Add a custom field: writes one named property shape into the extensions graph. Undoable. */
export async function cmdAddCustomField(ep: Endpoint, asset: AssetType, spec: CustomFieldSpec): Promise<void> {
  const shape = ASSET_SHAPE[asset];
  const path = spec.path?.trim() || `${STUDIO_VOCAB}${slug(spec.label)}`;
  const psIri = `${shape}/prop/${slug(spec.label)}`;
  const t: string[] = [
    `<${shape}> a <${SH.NodeShape}> .`,
    `<${shape}> <${SH.targetClass}> <${ASSET_CLASS[asset]}> .`,
    `<${shape}> <${SH.property}> <${psIri}> .`,
    `<${psIri}> a <${SH.PropertyShape}> .`,
    `<${psIri}> <${SH.path}> <${path}> .`,
    `<${psIri}> <${SH.name}> ${lit(spec.label)} .`,
    `<${psIri}> <${SH.order}> "${100}"^^<${XSD}integer> .`,
  ];
  if (spec.description?.trim()) t.push(`<${psIri}> <${SH.description}> ${lit(spec.description.trim())} .`);
  const dt = KIND_DATATYPE[spec.kind];
  if (dt) t.push(`<${psIri}> <${SH.datatype}> <${dt}> .`);
  if (spec.kind === 'multiline') t.push(`<${psIri}> <${DASH.singleLine}> false .`);
  if (spec.required) t.push(`<${psIri}> <${SH.minCount}> "1"^^<${XSD}integer> .`);
  if (spec.kind === 'codelist' && spec.codelist) t.push(`<${psIri}> <https://studio.local/ns#codelist> <${spec.codelist}> .`);
  const block = t.join('\n');
  const inList =
    spec.kind === 'enum' && spec.options?.length
      ? `<${psIri}> <${SH.in}> ( ${spec.options.map((o) => lit(o)).join(' ')} ) .`
      : '';
  const ins = `INSERT DATA { GRAPH <${EXT_GRAPH}> { ${block}\n${inList} } }`;
  // undo removes the whole property shape (incl. its sh:in list) + the link
  const del = `DELETE WHERE { GRAPH <${EXT_GRAPH}> { <${psIri}> ?p ?o } } ; DELETE WHERE { GRAPH <${EXT_GRAPH}> { <${shape}> <${SH.property}> <${psIri}> } }`;
  await useHistory.getState().exec({
    label: 'add custom field',
    redo: () => update(ep, ins),
    undo: () => update(ep, del),
  });
}

/** Remove a custom field (by its property-shape IRI). List cells are bnodes — swept by pattern. */
export async function cmdRemoveCustomField(ep: Endpoint, asset: AssetType, psIri: string): Promise<void> {
  const shape = ASSET_SHAPE[asset];
  // snapshot for undo
  const q = `SELECT ?p ?o WHERE { GRAPH <${EXT_GRAPH}> { <${psIri}> ?p ?o } }`;
  const r = await select(ep, q);
  const snapshot = r.bindings
    .filter((b) => b.o.type !== 'bnode')
    .map((b) => `<${psIri}> <${b.p.value}> ${b.o.type === 'uri' ? `<${b.o.value}>` : serializeTerm({ type: 'literal', value: b.o.value, datatype: (b.o as { datatype?: string }).datatype })} .`)
    .concat([`<${shape}> <${SH.property}> <${psIri}> .`])
    .join('\n');
  const del = `DELETE WHERE { GRAPH <${EXT_GRAPH}> { <${psIri}> ?p ?o } } ; DELETE WHERE { GRAPH <${EXT_GRAPH}> { <${shape}> <${SH.property}> <${psIri}> } }`;
  await useHistory.getState().exec({
    label: 'remove custom field',
    redo: () => update(ep, del),
    undo: () => update(ep, `INSERT DATA { GRAPH <${EXT_GRAPH}> { ${snapshot} } }`),
  });
}

/** The property-shape IRI a custom field was written under (for removal). */
export function customFieldPsIri(asset: AssetType, label: string): string {
  return `${ASSET_SHAPE[asset]}/prop/${slug(label)}`;
}

// ---------- pure triple building (shared by dialog + CSV import) ----------

export interface ConceptSpec {
  iri: string;
  scheme: string;
  broader?: string | null;
  /** path → raw values (already split for multi-value fields) */
  values: Map<string, string[]>;
}

/** Build the N-Triples-ish lines for one new concept. Pure — no I/O. */
export function buildConceptTriples(spec: ConceptSpec, fields: PropertyShapeInfo[]): string[] {
  const t: string[] = [
    `<${spec.iri}> a <${SKOS}Concept> .`,
    `<${spec.iri}> <${SKOS}inScheme> <${spec.scheme}> .`,
  ];
  if (spec.broader) t.push(`<${spec.iri}> <${SKOS}broader> <${spec.broader}> .`);
  else t.push(`<${spec.iri}> <${SKOS}topConceptOf> <${spec.scheme}> .`);
  const byPath = new Map(fields.map((f) => [f.path, f]));
  for (const [path, vals] of spec.values) {
    const field = byPath.get(path);
    for (const raw of vals) {
      const v = raw.trim();
      if (!v) continue;
      const isLang = field?.datatype === `${RDF_NS}langString`;
      const dt = !isLang && field?.datatype && field.datatype !== `${XSD}string` ? field.datatype : undefined;
      t.push(`<${spec.iri}> <${path}> ${serializeTerm({ type: 'literal', value: v, datatype: dt })} .`);
    }
  }
  return t;
}

/** One undoable INSERT for a batch of concepts (dialog: 1, CSV import: many). */
export async function cmdCreateConcepts(
  ep: Endpoint,
  graph: string | null,
  triples: string[],
  label = 'create concept'
): Promise<void> {
  const block = triples.join('\n');
  const wrap = (t: string) => (graph ? `GRAPH <${graph}> { ${t} }` : t);
  await useHistory.getState().exec({
    label,
    redo: () => update(ep, `INSERT DATA { ${wrap(block)} }`),
    undo: () => update(ep, `DELETE DATA { ${wrap(block)} }`),
  });
}
