// Shared meta-layer SPARQL access: every server module reads the graph the
// same way — union default graph, results+json.

export async function sparql(oxigraph, query) {
  const url = new URL(`${oxigraph}/query`);
  url.searchParams.set('union-default-graph', ''); // meta layer spans named graphs
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' },
    body: query,
  });
  if (!res.ok) throw new Error(`meta query ${res.status}`);
  return (await res.json()).results.bindings;
}
