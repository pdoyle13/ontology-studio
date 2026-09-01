// SSRF guard tests (remediation P1.4).
import { describe, it, expect } from 'vitest';
import { isPrivateIp, assertPublicUrl } from './net.mjs';

describe('isPrivateIp', () => {
    it('flags private / loopback / link-local / metadata IPv4', () => {
        for (const ip of ['10.0.0.1', '127.0.0.1', '172.16.5.4', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1']) {
            expect(isPrivateIp(ip)).toBe(true);
        }
    });
    it('allows public IPv4', () => {
        for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) {
            expect(isPrivateIp(ip)).toBe(false);
        }
    });
    it('flags loopback / ULA / link-local IPv6 and mapped v4', () => {
        for (const ip of ['::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254']) {
            expect(isPrivateIp(ip)).toBe(true);
        }
    });
    it('allows public IPv6', () => {
        expect(isPrivateIp('2606:4700:4700::1111')).toBe(false);
    });
    it('treats non-IP input as unsafe', () => {
        expect(isPrivateIp('not-an-ip')).toBe(true);
        expect(isPrivateIp(null)).toBe(true);
    });
});

describe('assertPublicUrl', () => {
    it('rejects non-http(s) schemes', async () => {
        await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/scheme/);
        await expect(assertPublicUrl('gopher://x/')).rejects.toThrow(/scheme/);
    });
    it('rejects localhost and private IP literals', async () => {
        await expect(assertPublicUrl('http://localhost/x')).rejects.toThrow(/localhost/);
        await expect(assertPublicUrl('http://127.0.0.1/x')).rejects.toThrow(/private/);
        await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/private/);
    });
    it('rejects garbage URLs', async () => {
        await expect(assertPublicUrl('not a url')).rejects.toThrow(/invalid URL/);
    });
    it('allows a public IP literal', async () => {
        await expect(assertPublicUrl('https://8.8.8.8/')).resolves.toBeInstanceOf(URL);
    });
    it('allowPrivate bypasses the check for config-supplied URLs', async () => {
        await expect(assertPublicUrl('http://127.0.0.1:9200/', { allowPrivate: true })).resolves.toBeInstanceOf(URL);
    });
});
