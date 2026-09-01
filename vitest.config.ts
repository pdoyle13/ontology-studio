import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // e2e/ belongs to @playwright/test — its specs are not vitest-runnable
        exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    },
});
