// Prototype-pollution-safe JSON parsing (remediation P1.8). Connector target
// descriptors and similar user-supplied JSON are parsed and then merged/spread
// into objects. A payload like {"__proto__": {"isAdmin": true}} can poison
// Object.prototype through some merge paths. Strip the dangerous keys at the
// parse boundary so nothing downstream has to remember to.

const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype']);

/** JSON.parse that drops __proto__ / constructor / prototype keys. */
export function parseJsonSafe(text) {
    return JSON.parse(String(text), (key, value) => (DANGEROUS.has(key) ? undefined : value));
}

/** Recursively strip dangerous keys from an already-parsed value (in place-safe copy). */
export function stripProto(value) {
    if (Array.isArray(value)) return value.map(stripProto);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (!DANGEROUS.has(k)) out[k] = stripProto(v);
        }
        return out;
    }
    return value;
}
