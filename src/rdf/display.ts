// Human-friendly display names: prefer rdfs:label, else humanize the IRI's
// local name (snake_case / camelCase → Title Case). Curies stay in tooltips.

import { localName } from './prefixes';

export function humanize(s: string): string {
  return String(s)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/** Best display name for a resource: label if present, else humanized local name. */
export function displayName(iri: string, label?: string | null): string {
  if (label && label.trim()) return label;
  return humanize(localName(iri));
}
