// API tokens: bearer credentials mapped to governance users. Only the SHA-256
// of a token is stored (in the server-state dir, never in the graph — graph
// snapshots are committed to git). The plaintext is returned exactly once.

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function createTokenStore(filePath) {
  let tokens = []; // {id, user, hash, createdAt, label}
  try {
    tokens = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    tokens = [];
  }
  const persist = () => {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(tokens, null, 2));
  };

  return {
    /** Returns {id, token} — the only time the plaintext exists. */
    create(user, label = '') {
      const token = `ostudio_${randomBytes(24).toString('hex')}`;
      const id = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
      tokens.push({ id, user, hash: sha256(token), createdAt: new Date().toISOString(), label });
      persist();
      return { id, token };
    },
    /** Bearer value → user name, or null. */
    verify(token) {
      const h = sha256(String(token ?? ''));
      return tokens.find((t) => t.hash === h)?.user ?? null;
    },
    list() {
      return tokens.map(({ id, user, createdAt, label }) => ({ id, user, createdAt, label }));
    },
    revoke(id) {
      const before = tokens.length;
      tokens = tokens.filter((t) => t.id !== id);
      if (tokens.length !== before) persist();
      return tokens.length !== before;
    },
  };
}
