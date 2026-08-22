// Modeling copilot: Grok (xAI, OpenAI-compatible tool calling) driving typed
// graph-editing tools (server/agentTools.mjs). Anthropic fallback when only
// ANTHROPIC_API_KEY is set. The model never writes update SPARQL directly.

import { buildTools } from './agentTools.mjs';

const MAX_TURNS = 16;

const SYSTEM = `You are the modeling copilot inside Ontology Studio, a visual RDF/SHACL editor backed by an Oxigraph triplestore.

Your job: help the user author and evolve their knowledge graph — classes, properties, SHACL shapes, instances, and the links between them (including cross-database joins for data lineage).

You act ONLY through your typed tools. Do not write SPARQL updates; the tools build them. sparql_query is a read-only escape hatch for inspection.

Method:
1. Call get_schema_overview first to learn what exists — classes, shapes, namespaces, naming conventions. Follow the conventions you find.
2. Make the change with the smallest set of typed tool calls. Create shapes alongside classes (SHACL-first: shapes drive the UI forms and validation). Do not use OWL axioms.
3. For cross-database lineage: materialized SQL data lives as instances typed per source table (e.g. orders, shipments from different databases). Use link_by_key to join them on shared business keys — that is how a lineage path (customer → order → shipment → delivery) gets connected across sources.
4. Report exactly what you created or changed (IRIs, counts) in a short list. Be concise.

If a request is ambiguous, make the reasonable modeling choice and state it.`;

function providerConfig() {
  const grokKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  if (grokKey) {
    return {
      kind: 'xai',
      key: grokKey,
      url: 'https://api.x.ai/v1/chat/completions',
      model: process.env.AGENT_MODEL || 'grok-4',
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      kind: 'anthropic',
      key: process.env.ANTHROPIC_API_KEY,
      url: 'https://api.anthropic.com/v1/messages',
      model: process.env.AGENT_MODEL || 'claude-sonnet-5',
    };
  }
  return null;
}

export function agentAvailable() {
  return !!providerConfig();
}

async function detectNamespace(oxigraph, graph) {
  try {
    const url = new URL(`${oxigraph}/query`);
    if (graph) url.searchParams.set('default-graph-uri', graph);
    else url.searchParams.set('union-default-graph', '');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' },
      body: 'SELECT ?cls WHERE { ?cls a <http://www.w3.org/2000/01/rdf-schema#Class> FILTER(isIRI(?cls)) } LIMIT 1',
    });
    const json = await res.json();
    const iri = json.results?.bindings?.[0]?.cls?.value;
    if (iri) {
      const m = iri.match(/^(.*[#/])[^#/]*$/);
      if (m) return m[1];
    }
  } catch { /* fall through */ }
  return null;
}

// ---------------- xAI (OpenAI-format) loop ----------------
async function runXai({ cfg, messages, tools, system }) {
  const toolDefs = tools.defs.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
  const convo = [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))];
  const trace = [];
  const byName = new Map(tools.defs.map((t) => [t.name, t]));

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, messages: convo, tools: toolDefs, tool_choice: 'auto' }),
    });
    if (!res.ok) throw new Error(`xAI API ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('xAI API returned no message');
    convo.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { reply: msg.content ?? '(no reply)', trace };
    }

    for (const call of msg.tool_calls) {
      const tool = byName.get(call.function?.name);
      let out;
      let ok = true;
      try {
        if (!tool) throw new Error(`unknown tool ${call.function?.name}`);
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        out = await tool.run(args);
        trace.push({ tool: tool.name, input: JSON.stringify(args).slice(0, 1500), ok: true });
      } catch (e) {
        out = `ERROR: ${e.message}`;
        ok = false;
        trace.push({ tool: call.function?.name ?? '?', input: (call.function?.arguments ?? '').slice(0, 1500), ok });
      }
      convo.push({ role: 'tool', tool_call_id: call.id, content: String(out) });
    }
  }
  return { reply: '(agent hit the turn limit — check the trace for what was applied)', trace };
}

// ---------------- Anthropic fallback loop ----------------
async function runAnthropic({ cfg, messages, tools, system }) {
  const toolDefs = tools.defs.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const convo = messages.map((m) => ({ role: m.role, content: m.content }));
  const trace = [];
  const byName = new Map(tools.defs.map((t) => [t.name, t]));

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, max_tokens: 4000, system, tools: toolDefs, messages: convo }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const msg = await res.json();
    convo.push({ role: 'assistant', content: msg.content });
    if (msg.stop_reason !== 'tool_use') {
      return { reply: msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'), trace };
    }
    const results = [];
    for (const block of msg.content) {
      if (block.type !== 'tool_use') continue;
      const tool = byName.get(block.name);
      let out;
      let isError = false;
      try {
        if (!tool) throw new Error(`unknown tool ${block.name}`);
        out = await tool.run(block.input ?? {});
      } catch (e) {
        out = `ERROR: ${e.message}`;
        isError = true;
      }
      trace.push({ tool: block.name, input: JSON.stringify(block.input ?? {}).slice(0, 1500), ok: !isError });
      results.push({ type: 'tool_result', tool_use_id: block.id, content: String(out), is_error: isError });
    }
    convo.push({ role: 'user', content: results });
  }
  return { reply: '(agent hit the turn limit — check the trace for what was applied)', trace };
}

export async function runAgent({ messages, graph, oxigraph }) {
  const cfg = providerConfig();
  if (!cfg) throw new Error('No agent API key: set GROK_API_KEY (or XAI_API_KEY / ANTHROPIC_API_KEY) on the studio server');

  const namespace = (await detectNamespace(oxigraph, graph)) ?? undefined;
  const tools = buildTools({ oxigraph, graph, namespace });
  const system = [
    SYSTEM,
    graph ? `Active named graph: <${graph}> — all tool writes are scoped to it automatically.` : 'No named graph selected — tools write to the default graph.',
    `Working namespace for minting new IRIs: ${tools.ns}`,
  ].join('\n\n');

  return cfg.kind === 'xai'
    ? runXai({ cfg, messages, tools, system })
    : runAnthropic({ cfg, messages, tools, system });
}
