// Server-side security regression tests (remediation P0.1 / P1.1).
// Encodes the confirmed SPARQL IRI-breakout exploit and its literal/datatype
// siblings against the server term serializer and the agent's IRI minting.
// A red here means an injection hole has reopened on the server side.

import { describe, it, expect } from 'vitest';
import { iri, literal, isValidIri, InvalidIriError } from '../core/term.mjs';
import { buildTools } from '../agent/agentTools.mjs';

// The exact payload proven against Oxigraph: the first `>` closes the IRI and
// the remainder executes as an UPDATE (DROP SILENT GRAPH).
const BREAKOUT =
    'https://x/a> <https://x/p> "v" } } ; DROP SILENT GRAPH <urn:target> ; INSERT DATA { GRAPH <urn:g> { <https://x/b';

describe('server term.mjs — IRIREF breakout defence', () => {
    it('serializes a benign IRI', () => {
        expect(iri('https://example.org/T')).toBe('<https://example.org/T>');
    });

    it('rejects the DROP-GRAPH breakout IRI', () => {
        expect(() => iri(BREAKOUT)).toThrow(InvalidIriError);
        expect(isValidIri(BREAKOUT)).toBe(false);
    });

    it('rejects every forbidden IRIREF character', () => {
        for (const ch of ['<', '>', '"', '{', '}', '|', '^', '`', '\\', ' ', '\n', '\t']) {
            expect(isValidIri(`https://x/${ch}`)).toBe(false);
        }
    });

    it('validates the datatype IRI on literals', () => {
        expect(() => literal('5', { datatype: `http://x/int> ; DROP GRAPH <g` })).toThrow(InvalidIriError);
    });

    it('escapes literal lexical forms so a quote cannot terminate them early', () => {
        const out = literal(BREAKOUT);
        expect(out.slice(1, -1)).not.toMatch(/(?<!\\)"/);
    });
});

describe('agent tools — no minted IRI can break out', () => {
    // buildTools needs no live endpoint to build a tool's SPARQL: we intercept the
    // update body by pointing at a fetch that records instead of sends.
    const captured = [];
    const origFetch = globalThis.fetch;

    function withCapturingFetch(fn) {
        return async () => {
            globalThis.fetch = async (_url, opts) => {
                captured.push(String(opts?.body ?? ''));
                return {
                    ok: true,
                    status: 200,
                    text: async () => 'OK',
                    json: async () => ({ results: { bindings: [] } }),
                };
            };
            try {
                await fn();
            } finally {
                globalThis.fetch = origFetch;
            }
        };
    }

    const { defs } = buildTools({
        oxigraph: 'http://127.0.0.1:1/x',
        graph: 'https://studio.local/g',
        namespace: 'https://studio.local/model#',
    });
    const tool = (name) => defs.find((t) => t.name === name);

    it(
        'create_class refuses a hostile name rather than minting a breakout',
        withCapturingFetch(async () => {
            const t = tool('create_class');
            await expect(
                t.run({ name: 'Evil> <p> <o> } } ; DROP SILENT GRAPH <urn:target> ; INSERT DATA { <s', label: 'x' }),
            ).rejects.toThrow();
        }),
    );

    it(
        'get_resource rejects a breakout IRI param',
        withCapturingFetch(async () => {
            const t = tool('get_resource');
            await expect(t.run({ iri: BREAKOUT })).rejects.toThrow();
        }),
    );

    it(
        'link_resources with a hostile predicate does not emit a DROP',
        withCapturingFetch(async () => {
            const t = tool('link_resources');
            await expect(
                t.run({ subject: 'A', predicate: 'p> <o> } } ; DROP SILENT GRAPH <urn:t> ; INSERT { <s', object: 'B' }),
            ).rejects.toThrow();
            expect(captured.join('\n')).not.toMatch(/DROP/i);
        }),
    );
});
