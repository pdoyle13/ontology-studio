// Server-side single source of truth for serializing RDF terms into SPARQL.
// Mirrors src/rdf/term.ts (kept in sync until the server is migrated to TS in
// remediation Phase 5, at which point both collapse into one module).
//
// SECURITY: every IRI that reaches a query string flows through `iri()`, which
// validates against the SPARQL 1.1 IRIREF grammar and throws on the characters
// an attacker (or the LLM agent, whose IRIs are untrusted output) would use to
// break out of `<...>` and inject query syntax.

export class InvalidIriError extends Error {
    constructor(value) {
        const shown = typeof value === 'string' ? value.slice(0, 120) : String(value);
        super(`Invalid IRI (forbidden IRIREF characters): ${JSON.stringify(shown)}`);
        this.name = 'InvalidIriError';
    }
}

// IRIREF forbids < > " { } | ^ ` \ and control chars / space (U+0000-U+0020).
// eslint-disable-next-line no-control-regex
const IRI_FORBIDDEN = /[\u0000-\u0020<>"{}|^\u0060\\]/;

export function isValidIri(value) {
    return typeof value === 'string' && value.length > 0 && !IRI_FORBIDDEN.test(value);
}

/** Serialize an absolute IRI as `<iri>`, or throw. */
export function iri(value) {
    if (!isValidIri(value)) throw new InvalidIriError(value);
    return `<${value}>`;
}

function escapeLiteral(value) {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}

const LANGTAG = /^[a-zA-Z]+(-[a-zA-Z0-9]+)*$/;
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

/** Serialize a literal with optional language tag or datatype IRI. */
export function literal(value, { lang, datatype } = {}) {
    const lex = `"${escapeLiteral(value)}"`;
    if (lang) {
        if (!LANGTAG.test(lang)) throw new Error(`Invalid language tag: ${JSON.stringify(lang)}`);
        return `${lex}@${lang}`;
    }
    if (datatype && datatype !== XSD_STRING) return `${lex}^^${iri(datatype)}`;
    return lex;
}
