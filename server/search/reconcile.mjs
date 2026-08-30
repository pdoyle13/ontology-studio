// W3C Reconciliation Service API over the search index — OpenRefine, and the
// import wizard's near-duplicate detection, both speak this. Exact
// (case-insensitive) label matches are certain; everything else scores by
// BM25 scaled into 0..100.

export function manifest(baseUrl) {
  return {
    versions: ['0.2'],
    name: 'Ontology Studio reconciliation',
    identifierSpace: 'https://studio.local/',
    schemaSpace: 'http://www.w3.org/2000/01/rdf-schema#',
    defaultTypes: [{ id: 'asset', name: 'Any asset' }],
    view: { url: `${baseUrl}/?workspace=explore#{{id}}` },
  };
}

/** Pure: raw hits + query → scored reconciliation candidates. */
export function scoreCandidates(queryText, hits, limit = 5) {
  const q = queryText.trim().toLowerCase();
  const maxScore = Math.max(...hits.map((h) => h._score ?? 0), 0.0001);
  return hits
    .map((h) => {
      const label = String(h._source?.label ?? '');
      const exact = label.trim().toLowerCase() === q;
      return {
        id: h._id,
        name: label || h._id,
        score: exact ? 100 : Math.round(((h._score ?? 0) / maxScore) * 90),
        match: exact,
        type: [{ id: String(h._source?.type ?? h._source?.kind ?? 'asset'), name: String(h._source?.type ?? h._source?.kind ?? 'asset') }],
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Execute a reconciliation batch: {q0: {query, limit?}, ...} → {q0: {result}}. */
export async function reconcileBatch(searchSvc, queries) {
  const out = {};
  for (const [key, spec] of Object.entries(queries ?? {})) {
    const text = String(spec?.query ?? '').trim();
    if (!text) {
      out[key] = { result: [] };
      continue;
    }
    const r = await searchSvc.search({
      query: { multi_match: { query: text, fields: ['label^3', 'text'] } },
      size: Math.min(20, (spec.limit ?? 5) * 4),
    });
    out[key] = { result: scoreCandidates(text, r.hits?.hits ?? [], spec.limit ?? 5) };
  }
  return out;
}
