// E2E suite for Ontology Studio. Requires the dev stack: studio-ui :5180, studio-server
// :7881, Oxigraph, seed data loaded. Workers=1 — the suite shares one live
// backend and several specs write to it (each uses run-unique fixtures).

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5180',
    viewport: { width: 1600, height: 900 },
    trace: 'retain-on-failure',
  },
});
