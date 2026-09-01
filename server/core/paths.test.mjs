// Path-confinement tests (remediation P1.5).
import { describe, it, expect } from 'vitest';
import { isInsideRoot, assertInsideRoot } from './paths.mjs';

const ROOT = process.platform === 'win32' ? 'C:\\data\\root' : '/data/root';

describe('isInsideRoot', () => {
    it('accepts paths inside the root', () => {
        expect(isInsideRoot(ROOT, 'db/app.sqlite')).toBe(true);
        expect(isInsideRoot(ROOT, './seed/x.db')).toBe(true);
        expect(isInsideRoot(ROOT, ROOT)).toBe(true);
    });
    it('rejects traversal and absolute escapes', () => {
        expect(isInsideRoot(ROOT, '../secret')).toBe(false);
        expect(isInsideRoot(ROOT, 'a/../../secret')).toBe(false);
        const abs = process.platform === 'win32' ? 'C:\\Windows\\system32' : '/etc/passwd';
        expect(isInsideRoot(ROOT, abs)).toBe(false);
    });
});

describe('assertInsideRoot', () => {
    it('returns the resolved path when inside', () => {
        const p = assertInsideRoot(ROOT, 'sub/x.db', 'sqlite file');
        expect(p.startsWith(ROOT)).toBe(true);
    });
    it('throws when outside', () => {
        expect(() => assertInsideRoot(ROOT, '../../etc/passwd', 'sqlite file')).toThrow(
            /escapes the permitted data root/,
        );
    });
});
