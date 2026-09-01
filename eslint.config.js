// ESLint flat config covering the whole repo: React/TS front end, the Node
// sidecar, and the Playwright suite. oxlint still runs as the fast pass
// (`npm run lint`); this is the type-aware/hooks-aware pass (`npm run lint:es`).

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.oxigraph-data/**',
      'graph/**',
      'server/.cache/**',
      'server/.state/**',
      'sdk/**',           // python
      'seed/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },

  // ---- browser: React + TypeScript ----
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Correctness rules stay errors — these catch real bugs.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // React-Compiler advisory rules: useful signal, but they fire on
      // patterns this codebase uses deliberately — data loading inside an
      // effect, ref mutation, Date.now() inside event handlers. Kept visible
      // as warnings rather than blocking the build.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/use-memo': 'warn',
      // unused args/vars are allowed only when explicitly underscored
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // the codebase deliberately uses `any` at a few RDF/JSON boundaries
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // ---- Node sidecar (ESM .mjs) ----
  {
    files: ['server/**/*.mjs', 'scripts/**/*.mjs', '*.config.{js,ts}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },

  // ---- tests: vitest (node) + playwright ----
  {
    files: ['**/*.test.{ts,tsx,mjs}', 'e2e/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
);
