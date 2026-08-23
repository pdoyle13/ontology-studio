import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createTokenStore } from './tokens.mjs';
import { createOidcVerifier } from './oidc.mjs';
import { createRegistry } from '../core/metrics.mjs';

describe('token store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yaoe-tok-'));
  const file = join(dir, 'tokens.json');

  it('creates, verifies, lists (no hashes leaked), revokes, persists', () => {
    const store = createTokenStore(file);
    const { id, token } = store.create('sam', 'ci token');
    expect(token).toMatch(/^yaoe_[0-9a-f]{48}$/);
    expect(store.verify(token)).toBe('sam');
    expect(store.verify('yaoe_nope')).toBeNull();
    expect(store.list()[0]).toEqual(expect.objectContaining({ id, user: 'sam', label: 'ci token' }));
    expect(JSON.stringify(store.list())).not.toContain(token);

    // survives a reload from disk
    const store2 = createTokenStore(file);
    expect(store2.verify(token)).toBe('sam');
    expect(store2.revoke(id)).toBe(true);
    expect(store2.verify(token)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('oidc verifier', () => {
  let server;
  let url;
  let privateKey;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    server = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise((r) => server.listen(0, r));
    url = `http://127.0.0.1:${server.address().port}/jwks`;
  });

  afterAll(() => server?.close());

  it('verifies a signed JWT and maps the subject', async () => {
    const v = createOidcVerifier({ jwksUrl: url, issuer: 'https://idp.test', audience: 'yaoe' });
    const jwt = await new SignJWT({ preferred_username: 'sam' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer('https://idp.test')
      .setAudience('yaoe')
      .setSubject('sam-sub')
      .setExpirationTime('5m')
      .sign(privateKey);
    const out = await v.verify(jwt);
    expect(out.subject).toBe('sam');
  });

  it('rejects wrong issuer and garbage tokens', async () => {
    const v = createOidcVerifier({ jwksUrl: url, issuer: 'https://idp.test' });
    const bad = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer('https://evil.test').setExpirationTime('5m').sign(privateKey);
    await expect(v.verify(bad)).rejects.toThrow();
    await expect(v.verify('not.a.jwt')).rejects.toThrow();
  });

  it('disabled without config', () => {
    expect(createOidcVerifier({ jwksUrl: undefined })).toBeNull();
  });
});

describe('metrics registry', () => {
  it('counters and histograms render Prometheus text', () => {
    const m = createRegistry();
    m.inc('http_requests_total', { route: '/api/search', method: 'GET', status: '200' });
    m.inc('http_requests_total', { route: '/api/search', method: 'GET', status: '200' });
    m.observe('http_request_duration_ms', 12, { route: '/api/search' });
    m.observe('http_request_duration_ms', 300, { route: '/api/search' });
    const text = m.promText();
    expect(text).toContain('# TYPE http_requests_total counter');
    expect(text).toContain('http_requests_total{method="GET",route="/api/search",status="200"} 2');
    expect(text).toContain('http_request_duration_ms_bucket{route="/api/search",le="25"} 1');
    expect(text).toContain('http_request_duration_ms_count{route="/api/search"} 2');
    expect(text).toContain('process_resident_memory_bytes');
  });
});
