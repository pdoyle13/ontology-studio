// Path-traversal guard (remediation P1.5). File-backed connectors (sqlite,
// duckdb) take a filesystem path from an API call; without confinement a caller
// could attach /etc/passwd or traverse out of the data directory. Paths must
// resolve inside a configured DATA_ROOT.

import { resolve, relative, isAbsolute } from 'node:path';

/** True if `p` resolves to a location inside `root` (or is root itself). */
export function isInsideRoot(root, p) {
    const absRoot = resolve(root);
    const abs = resolve(absRoot, String(p));
    const rel = relative(absRoot, abs);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Return the resolved absolute path if inside `root`, else throw. */
export function assertInsideRoot(root, p, label = 'path') {
    if (!isInsideRoot(root, p)) {
        throw new Error(`${label} escapes the permitted data root: ${JSON.stringify(String(p).slice(0, 120))}`);
    }
    return resolve(resolve(root), String(p));
}
