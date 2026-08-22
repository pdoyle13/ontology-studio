// Client-side constraint enforcement for shape-driven inputs: validate a raw
// input string against the property shape BEFORE writing, and pick the widget.

import type { PropertyShapeInfo } from './shacl';
import { datatypeToKind } from './shacl';

export type Widget = 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'enum' | 'iri';

export function widgetFor(ps: PropertyShapeInfo): Widget {
  if (ps.inValues && ps.inValues.length > 0) return 'enum';
  if (ps.classIri) return 'iri';
  switch (datatypeToKind(ps.datatype)) {
    case 'integer':
    case 'decimal':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'dateTime':
      return 'datetime';
    default:
      return 'text';
  }
}

/** Validate raw input against the shape's constraints. Returns an error message or null. */
export function validateAgainstShape(ps: PropertyShapeInfo, raw: string): string | null {
  const v = raw.trim();
  if (v === '') return 'value is empty';
  const kind = datatypeToKind(ps.datatype);

  if (kind === 'integer' && !/^[+-]?\d+$/.test(v)) return `must be an integer (xsd:${ps.datatype?.split('#').pop()})`;
  if (kind === 'decimal' && !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(v)) return 'must be a decimal number';
  if (kind === 'boolean' && v !== 'true' && v !== 'false') return 'must be true or false';
  if (kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'must be a date (YYYY-MM-DD)';
  if (kind === 'dateTime' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/.test(v))
    return 'must be a dateTime (YYYY-MM-DDTHH:MM)';

  if ((kind === 'integer' || kind === 'decimal') && (ps.minInclusive !== null || ps.maxInclusive !== null)) {
    const n = Number(v);
    if (ps.minInclusive !== null && n < Number(ps.minInclusive)) return `must be ≥ ${ps.minInclusive}`;
    if (ps.maxInclusive !== null && n > Number(ps.maxInclusive)) return `must be ≤ ${ps.maxInclusive}`;
  }

  if (ps.pattern) {
    try {
      if (!new RegExp(ps.pattern).test(v)) return `must match pattern ${ps.pattern}`;
    } catch {
      /* invalid regex in shape — don't block the user */
    }
  }

  if (ps.inValues && ps.inValues.length > 0 && !ps.inValues.some((iv) => iv.value === v))
    return `must be one of: ${ps.inValues.map((iv) => iv.value).join(', ')}`;

  return null;
}
