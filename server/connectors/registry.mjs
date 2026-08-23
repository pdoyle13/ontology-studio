// Pluggable connector registry: every .mjs file in this directory (except this
// one) that exports { meta, create } is a connector. Drop a new file in, and
// it appears in /api/sql/kinds and the UI — no registration code anywhere.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const registry = new Map(); // kind → { meta, create }

for (const file of readdirSync(HERE)) {
  if (!file.endsWith('.mjs') || file === 'registry.mjs' || file.endsWith('.test.mjs')) continue;
  const mod = await import(`./${file}`);
  if (mod.meta?.kind && typeof mod.create === 'function') {
    registry.set(mod.meta.kind, { meta: mod.meta, create: mod.create });
  }
}

export function connectorKinds() {
  return [...registry.values()].map(({ meta }) => meta);
}

export function createDriver({ id, kind = 'sqlite', target }) {
  const entry = registry.get(kind);
  if (!entry) throw new Error(`unknown connector kind '${kind}' (available: ${[...registry.keys()].join(', ')})`);
  return entry.create(id, target);
}

/** Strip credentials from a connection descriptor before it's stored or displayed. */
export function safeDescriptor(kind, target) {
  const meta = registry.get(kind)?.meta;
  if (meta?.targetKind === 'json') {
    try {
      const o = typeof target === 'string' ? JSON.parse(target) : target;
      return JSON.stringify({ ...o, password: undefined, token: undefined, privateKey: undefined });
    } catch {
      return `${kind}:{…}`;
    }
  }
  if (meta?.targetKind !== 'url') return target;
  try {
    const u = new URL(target);
    u.password = '';
    u.username = u.username ? '***' : '';
    return u.toString();
  } catch {
    return `${kind}://…`;
  }
}
