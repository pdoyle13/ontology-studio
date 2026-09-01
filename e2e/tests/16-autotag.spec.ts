import { test, expect } from '@playwright/test';
import { runTag } from './helpers';

const API = 'http://localhost:7881';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';

test.describe('auto-tagging (request-level)', () => {
    test('tags text with concepts: word boundaries, altLabels, longest label wins', async ({ request }) => {
        const tag = runTag();
        const G = `https://example.org/graphs/autotag-${tag}`;
        const scheme = `https://example.org/at/${tag}/genres`;
        const seed = await request.post(`${API}/db/update`, {
            headers: { 'Content-Type': 'application/sparql-update', 'X-Studio-User': 'pat' },
            data: `INSERT DATA { GRAPH <${G}> {
        <${scheme}#jazz> <${SKOS}inScheme> <${scheme}> ; <${SKOS}prefLabel> "Jazz" .
        <${scheme}#fusion> <${SKOS}inScheme> <${scheme}> ; <${SKOS}prefLabel> "Jazz Fusion" .
        <${scheme}#ml> <${SKOS}inScheme> <${scheme}> ; <${SKOS}prefLabel> "Machine Learning" ; <${SKOS}altLabel> "ML models" .
      } }`,
        });
        expect([200, 204]).toContain(seed.status());
        try {
            const text =
                'Jazz Fusion blends jazz with rock. Our ML models classify each Jazz record; Jazzercise is unrelated.';
            const tags = await (await request.post(`${API}/api/tag`, { data: { text, scheme } })).json();
            const byIri = Object.fromEntries(
                tags.map((t: { iri: string; count: number; label: string }) => [t.iri, t]),
            );

            // longest label claimed its span: "Jazz Fusion" is fusion, not jazz+fusion
            expect(byIri[`${scheme}#fusion`].count).toBe(1);
            // "jazz" (lowercase) + "Jazz record" = 2; "Jazzercise" must NOT match (word boundary)
            expect(byIri[`${scheme}#jazz`].count).toBe(2);
            // altLabel matched
            expect(byIri[`${scheme}#ml`].count).toBe(1);
            expect(byIri[`${scheme}#ml`].spans[0].surface).toBe('ML models');

            // missing text → 400
            const bad = await request.post(`${API}/api/tag`, { data: {} });
            expect(bad.status()).toBe(400);
        } finally {
            await request.post(`${API}/db/update`, {
                headers: { 'Content-Type': 'application/sparql-update', 'X-Studio-User': 'pat' },
                data: `DROP SILENT GRAPH <${G}>`,
            });
        }
    });
});
