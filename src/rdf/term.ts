// Single source of truth for serializing RDF terms into SPARQL/Turtle syntax.
//
// SECURITY: every IRI that reaches a query string flows through `iri()`, which
// validates against the SPARQL 1.1 IRIREF grammar and throws on the characters
// an attacker would use to break out of the `<...>` and inject query syntax.
// A hostile IRI such as `https://x/a> ; DROP SILENT GRAPH <g> ; ...` is what the
// old `<${value}>` interpolation happily emitted. Do not reintroduce raw
// angle-bracket interpolation of untrusted values — call `iri()`.

export class InvalidIriError extends Error {
  constructor(value: unknown) {
    const shown = typeof value === 'string' ? value.slice(0, 120) : String(value);
    super(`Invalid IRI (contains characters forbidden by the IRIREF grammar): ${JSON.stringify(shown)}`);
    this.name = 'InvalidIriError';
  }
}

// IRIREF ::= '<' ([^<>"{}|^`\]-[#x00-#x20])* '>'  (SPARQL 1.1, section 19.8):
// an IRI may not contain < > " { } | ^ ` \ or any control character / space
// (U+0000-U+0020). Valid IRIs percent-encode all of these. Expressed with
// explicit \u escapes so the class is unambiguous.
// eslint-disable-next-line no-control-regex -- the grammar is defined over control chars
const IRI_FORBIDDEN = /[\u0000-\u0020<>"{}|^\u0060\\]/;

export function isValidIri(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !IRI_FORBIDDEN.test(value);
}

/** Serialize an absolute IRI as `<iri>`, or throw `InvalidIriError`. */
export function iri(value: string): string {
  if (!isValidIri(value)) throw new InvalidIriError(value);
  return `<${value}>`;
}

// Turtle/SPARQL string-literal escaping: backslash first, then the rest.
function escapeLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

// LANGTAG ::= '@' [a-zA-Z]+ ('-' [a-zA-Z0-9]+)*
const LANGTAG = /^[a-zA-Z]+(-[a-zA-Z0-9]+)*$/;

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

export interface LiteralOpts {
  lang?: string;
  datatype?: string;
}

/** Serialize a literal with optional language tag or datatype IRI. */
export function literal(value: string, opts: LiteralOpts = {}): string {
  const lex = `"${escapeLiteral(String(value))}"`;
  if (opts.lang) {
    if (!LANGTAG.test(opts.lang)) throw new Error(`Invalid language tag: ${JSON.stringify(opts.lang)}`);
    return `${lex}@${opts.lang}`;
  }
  if (opts.datatype && opts.datatype !== XSD_STRING) {
    return `${lex}^^${iri(opts.datatype)}`;
  }
  return lex;
}

// Blank-node label and variable name grammars are narrower than IRIs; we accept
// the common subset (alnum, `_`, `-`, `.`) which covers every label the app mints.
const PN_LOCAL = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

export function bnode(label: string): string {
  if (typeof label !== 'string' || !PN_LOCAL.test(label)) {
    throw new Error(`Invalid blank-node label: ${JSON.stringify(label)}`);
  }
  return `_:${label}`;
}

export function variable(name: string): string {
  if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid variable name: ${JSON.stringify(name)}`);
  }
  return `?${name}`;
}

/** Shape mirroring the app's existing hand-rolled term union. */
export type TermValue =
  | { type: 'uri'; value: string }
  | { type: 'bnode'; value: string }
  | { type: 'literal'; value: string; lang?: string; datatype?: string };

/** Serialize any TermValue, validating IRIs and datatype IRIs. */
export function serializeTerm(t: TermValue): string {
  if (t.type === 'uri') return iri(t.value);
  if (t.type === 'bnode') return bnode(t.value);
  return literal(t.value, { lang: t.lang, datatype: t.datatype });
}
