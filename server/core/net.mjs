// SSRF guard (remediation P1.4). User-supplied URLs (REST connector baseUrl,
// import-from-URL) are fetched server-side, so a hostile value like
// http://169.254.169.254/latest/meta-data/ would let a caller reach the cloud
// metadata service or internal hosts. `assertPublicUrl` rejects non-http(s)
// schemes and any host that resolves to a private / loopback / link-local /
// metadata address.
//
// Limitation: this checks the resolved address before the fetch; it does not
// pin the socket to that address, so a determined DNS-rebinding attacker could
// still swing the name to a private IP between check and connect. Pinning would
// require a custom agent/lookup — tracked as a follow-up. This closes the
// direct-private-URL and metadata-IP cases, which are the common ones.

import { lookup } from 'node:dns/promises';
import net from 'node:net';

/** True if an IP literal is in a private / loopback / link-local / reserved range. */
export function isPrivateIp(ip) {
    if (typeof ip !== 'string') return true;
    const v = net.isIP(ip);
    if (v === 4) return isPrivateV4(ip);
    if (v === 6) return isPrivateV6(ip);
    return true; // not a parseable IP → treat as unsafe
}

function isPrivateV4(ip) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // 0.0.0.0/8 "this host"
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
}

function isPrivateV6(ip) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    // IPv4-mapped (::ffff:a.b.c.d) — check the embedded v4
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateV4(mapped[1]);
    const head = lower.split(':')[0];
    const h = parseInt(head, 16);
    if (Number.isNaN(h)) return true;
    if ((h & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((h & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    return false;
}

/**
 * Validate a user-supplied URL for server-side fetching.
 * @param {string} urlString
 * @param {{ allowPrivate?: boolean }} [opts] allowPrivate:true is for
 *   config-supplied URLs (search/backup/LLM endpoints), never user input.
 * @returns {Promise<URL>} the parsed URL when safe; throws otherwise.
 */
export async function assertPublicUrl(urlString, { allowPrivate = false } = {}) {
    let url;
    try {
        url = new URL(String(urlString));
    } catch {
        throw new Error(`invalid URL: ${JSON.stringify(String(urlString).slice(0, 80))}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`blocked URL scheme '${url.protocol}' (only http/https allowed)`);
    }
    if (allowPrivate) return url;

    const host = url.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
    if (host.toLowerCase() === 'localhost') throw new Error('blocked: localhost is not a public host');

    // If the host is an IP literal, check it directly; otherwise resolve it.
    if (net.isIP(host)) {
        if (isPrivateIp(host)) throw new Error(`blocked: ${host} is a private/reserved address`);
        return url;
    }
    let addrs;
    try {
        addrs = await lookup(host, { all: true });
    } catch {
        throw new Error(`could not resolve host: ${host}`);
    }
    for (const { address } of addrs) {
        if (isPrivateIp(address)) throw new Error(`blocked: ${host} resolves to private address ${address}`);
    }
    return url;
}
