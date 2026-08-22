// Modeling copilot: a server-side agent loop against the Anthropic API with
// SPARQL tools over the studio's Oxigraph. Helps author classes, shapes,
// properties, and connections. SHACL-first by design.

const MODEL = process.env.AGENT_MODEL ?? 'claude-sonnet-5';
const MAX_TURNS = 12;

const SYSTEM = `You are the modeling copilot inside Ontology Studio, a visual RDF/SHACL editor backed by an Oxigraph triplestore.

Your job: help the user author and evolve their ontology — classes, properties, SHACL node/property shapes, instances, and the connections between them. You act by executing SPARQL against the store using your tools.

Principles:
- SHACL-first. Every class you create should get a sh:NodeShape with sh:targetClass and property shapes (sh:path, sh:name, sh:datatype or sh:class, sh:minCount/sh:maxCount, sh:order). Shapes are the model contract; the UI renders forms from them.
- Use rdfs:Class, rdfs:label, rdfs:subClassOf, rdfs:domain/range for the ontology skeleton. Do NOT use OWL axioms (no restrictions, no DL) unless the user explicitly asks.
- Mint IRIs in the user's namespace. Infer it from existing data (query first!); if none exists, ask or use https://studio.local/model#. Property-shape IRIs: <ShapeIRI>-p-<localname>.
- ALWAYS query before you write: check what already exists (classes, shapes, prefixes, naming conventions) and follow the established conventions.
- Write into the active named graph when one is given. Use GRAPH <g> { } in updates, and query with the graph in mind.
- Keep updates small and reviewable: one logical change per sparql_update call. Report exactly what you created or changed.
- If the user's request is ambiguous, make the reasonable modeling choice and state it — don't stall on questions for small decisions.

Answer style: concise. After acting, summarize what changed (IRIs created, constraints set) in a short list the user can verify in the UI.`;

function tools() {
  return [
    {
      name: 'sparql_query',
      description:
        'Run a SPARQL SELECT/ASK query against the store. Returns JSON results. Use to inspect existing classes, shapes, namespaces, and data before modeling.',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'SPARQL query text' } },
        required: ['query'],
      },
    },
    {
      name: 'sparql_update',
      description:
        'Run a SPARQL UPDATE (INSERT DATA / DELETE DATA / DELETE-INSERT-WHERE) against the store. Use GRAPH blocks when a named graph is active.',
      input_schema: {
        type: 'object',
        properties: { update: { type: 'string', description: 'SPARQL update text' } },
        required: ['update'],
      },
    },
  ];
}

async function sparqlQuery(oxigraph, query, graph) {
  const url = new URL(`${oxigraph}/query`);
  if (graph) url.searchParams.set('default-graph-uri', graph);
  else url.searchParams.set('union-default-graph', '');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' },
    body: query,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`query ${res.status}: ${text.slice(0, 500)}`);
  // trim huge result sets before they hit the model
  return text.length > 20000 ? `${text.slice(0, 20000)}\n…(truncated)` : text;
}

async function sparqlUpdate(oxigraph, update) {
  const res = await fetch(`${oxigraph}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sparql-update' },
    body: update,
  });
  if (!res.ok) throw new Error(`update ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return 'OK';
}

/**
 * Run the agent loop. `messages` is [{role, content}] with plain-text content.
 * Returns { reply, trace } — trace lists tool calls for UI display.
 */
export async function runAgent({ messages, graph, oxigraph }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set on the studio server');

  const system = graph
    ? `${SYSTEM}\n\nActive named graph: <${graph}>. Scope reads and writes to it (updates: wrap triples in GRAPH <${graph}> { … }; queries are already scoped server-side).`
    : `${SYSTEM}\n\nNo named graph selected — the default graph union is queried; write to the default graph unless told otherwise.`;

  const convo = messages.map((m) => ({ role: m.role, content: m.content }));
  const trace = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, system, tools: tools(), messages: convo }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const msg = await res.json();

    convo.push({ role: 'assistant', content: msg.content });

    if (msg.stop_reason !== 'tool_use') {
      const reply = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      return { reply, trace };
    }

    const results = [];
    for (const block of msg.content) {
      if (block.type !== 'tool_use') continue;
      let out;
      let isError = false;
      try {
        if (block.name === 'sparql_query') out = await sparqlQuery(oxigraph, block.input.query, graph);
        else if (block.name === 'sparql_update') out = await sparqlUpdate(oxigraph, block.input.update);
        else out = `unknown tool ${block.name}`;
      } catch (e) {
        out = String(e.message);
        isError = true;
      }
      trace.push({
        tool: block.name,
        input: (block.input.query ?? block.input.update ?? '').slice(0, 2000),
        ok: !isError,
      });
      results.push({ type: 'tool_result', tool_use_id: block.id, content: out, is_error: isError });
    }
    convo.push({ role: 'user', content: results });
  }
  return { reply: '(agent hit the turn limit — partial work may have been applied; check the trace)', trace };
}
