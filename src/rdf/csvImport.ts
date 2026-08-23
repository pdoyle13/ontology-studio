// CSV bulk import for taxonomies: pure parse → map → validate → build stages
// so every rule is unit-testable. Columns map to the same shape-driven fields
// the create dialog uses (built-in SKOS + configured custom fields), so a
// custom field is importable the moment it's configured — no extra wiring.

import type { PropertyShapeInfo } from './shacl';
import { validateAgainstShape } from './constraints';
import { SKOS } from './skos';
import { slug, buildConceptTriples, type ConceptSpec } from './skosExt';

// ---------- parse ----------

/** RFC-4180-ish CSV parser: quoted fields, embedded commas/newlines/"" escapes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const src = text.replace(/\r\n/g, '\n').replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ---------- header mapping ----------

export interface ColumnMap {
  /** column index → field (null = ignored column) */
  columns: (PropertyShapeInfo | null)[];
  broaderCol: number; // -1 if absent
  prefCol: number; // -1 if absent
  ignored: string[];
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s_-]+/g, '');

/** Map CSV headers to fields by sh:name or path local name (case/space-insensitive). */
export function mapHeaders(headers: string[], fields: PropertyShapeInfo[]): ColumnMap {
  const aliases = new Map<string, PropertyShapeInfo>();
  for (const f of fields) {
    if (f.name) aliases.set(norm(f.name), f);
    aliases.set(norm(f.path.split(/[#/]/).pop() ?? ''), f);
  }
  // common spreadsheet spellings for the built-ins
  const pref = fields.find((f) => f.path === `${SKOS}prefLabel`);
  const alt = fields.find((f) => f.path === `${SKOS}altLabel`);
  const def = fields.find((f) => f.path === `${SKOS}definition`);
  if (pref) ['label', 'name', 'term', 'preflabel'].forEach((a) => aliases.set(a, pref));
  if (alt) ['synonyms', 'altlabels', 'alternatives'].forEach((a) => aliases.set(a, alt));
  if (def) ['description', 'def'].forEach((a) => aliases.set(a, def));

  const columns: (PropertyShapeInfo | null)[] = [];
  let broaderCol = -1;
  let prefCol = -1;
  const ignored: string[] = [];
  headers.forEach((h, i) => {
    const key = norm(h);
    if (['broader', 'parent', 'broaderconcept', 'parentconcept'].includes(key)) {
      broaderCol = i;
      columns.push(null);
      return;
    }
    const f = aliases.get(key) ?? null;
    columns.push(f);
    if (f?.path === `${SKOS}prefLabel`) prefCol = i;
    if (!f) ignored.push(h.trim());
  });
  return { columns, broaderCol, prefCol, ignored };
}

// ---------- validate ----------

export interface RowReport {
  index: number; // 0-based data-row index
  pref: string;
  broader: string; // raw broader cell
  errors: string[];
  /** resolved broader IRI (existing concept or earlier row), null = top concept */
  broaderIri: string | null;
  iri: string;
}

export interface ExistingConcept {
  iri: string;
  label: string | null;
}

/**
 * Validate data rows. Broader resolves against existing concepts (by label,
 * case-insensitive, or IRI) and against EARLIER rows in the file — so a
 * spreadsheet can define a whole tree top-down in one import.
 */
export function validateRows(
  dataRows: string[][],
  map: ColumnMap,
  opts: { scheme: string; existing: ExistingConcept[] }
): RowReport[] {
  const reports: RowReport[] = [];
  const byLabel = new Map<string, string>();
  for (const e of opts.existing) if (e.label) byLabel.set(e.label.trim().toLowerCase(), e.iri);
  const existingIris = new Set(opts.existing.map((e) => e.iri));
  const schemeBase = opts.scheme.replace(/[#/]$/, '');
  const seenInFile = new Map<string, number>();

  dataRows.forEach((cells, index) => {
    const errors: string[] = [];
    const pref = (map.prefCol >= 0 ? cells[map.prefCol] ?? '' : '').trim();
    const broaderRaw = (map.broaderCol >= 0 ? cells[map.broaderCol] ?? '' : '').trim();

    if (!pref) errors.push('missing preferred label');
    const key = pref.toLowerCase();
    if (pref && seenInFile.has(key)) errors.push(`duplicate of row ${seenInFile.get(key)! + 1}`);
    if (pref && byLabel.has(key)) errors.push('a concept with this label already exists in the scheme');

    // constraint validation per mapped column
    map.columns.forEach((f, ci) => {
      const raw = (cells[ci] ?? '').trim();
      if (!f || !raw) return;
      const parts = f.maxCount === null ? raw.split('|') : [raw];
      for (const part of parts) {
        const err = part.trim() ? validateAgainstShape(f, part.trim()) : null;
        if (err) errors.push(`${f.name ?? 'column'}: ${err}`);
      }
    });
    // required custom fields
    for (const f of map.columns) void f;

    // broader resolution
    let broaderIri: string | null = null;
    if (broaderRaw) {
      if (/^https?:\/\//.test(broaderRaw)) {
        if (existingIris.has(broaderRaw) || [...seenInFile.keys()].some((k) => `${schemeBase}/${slug(k)}` === broaderRaw)) broaderIri = broaderRaw;
        else errors.push(`broader IRI not found: ${broaderRaw}`);
      } else {
        const bKey = broaderRaw.toLowerCase();
        if (byLabel.has(bKey)) broaderIri = byLabel.get(bKey)!;
        else if (seenInFile.has(bKey) && seenInFile.get(bKey)! < index) broaderIri = `${schemeBase}/${slug(broaderRaw)}`;
        else errors.push(`broader “${broaderRaw}” matches no existing concept or earlier row`);
      }
    }

    if (pref && !errors.length) seenInFile.set(key, index);
    reports.push({ index, pref, broader: broaderRaw, errors, broaderIri, iri: `${schemeBase}/${slug(pref || `row-${index}`)}` });
  });
  return reports;
}

// ---------- build ----------

/** Triples for every valid row (skips rows with errors). */
export function buildImportTriples(
  dataRows: string[][],
  map: ColumnMap,
  reports: RowReport[],
  opts: { scheme: string; fields: PropertyShapeInfo[] }
): { triples: string[]; imported: number } {
  const triples: string[] = [];
  let imported = 0;
  reports.forEach((rep) => {
    if (rep.errors.length || !rep.pref) return;
    const cells = dataRows[rep.index];
    const values = new Map<string, string[]>();
    map.columns.forEach((f, ci) => {
      const raw = (cells[ci] ?? '').trim();
      if (!f || !raw) return;
      const parts = f.maxCount === null ? raw.split('|').map((x) => x.trim()).filter(Boolean) : [raw];
      values.set(f.path, [...(values.get(f.path) ?? []), ...parts]);
    });
    const spec: ConceptSpec = { iri: rep.iri, scheme: opts.scheme, broader: rep.broaderIri, values };
    triples.push(...buildConceptTriples(spec, opts.fields));
    imported++;
  });
  return { triples, imported };
}
