---
name: studio-agent
description: Exercise or extend the studio's Grok agent — API testing patterns, the typed-tool registry, and the rules for adding tools. Use when testing agent behavior or adding capabilities.
---

# Studio agent

Grok (xAI) with **typed tools only** — the model never writes SPARQL updates
and never puts instance data in the graph. Provider config in `server/agent.mjs`
(`GROK_API_KEY` in `.env`; `AGENT_MODEL` env, default `grok-4`; Anthropic fallback).

## Testing pattern (shell quoting will burn you — use files)

Write the request to the scratchpad with the Write tool:

```json
{ "graph": "https://studio.local/graphs/lineage",
  "messages": [{ "role": "user", "content": "…" }] }
```

```bash
curl -s -X POST http://localhost:7881/api/agent -H "Content-Type: application/json" \
  --data-binary @request.json | python show-agent.py    # prints TRACE + REPLY
```

Long timeout (grok-4 multi-tool runs take 1–5 min). The response `trace` lists
every tool call with ok/err — an empty `reply` falls back to a trace summary.

## Tool registry (`server/agentTools.mjs`)

Reads: `get_schema_overview` · `get_resource` · `get_data_catalog` (KG-derived,
includes FIBO areas + link join keys) · `sparql_query` (SELECT/ASK only).
Meta writes: `create_class` · `create_property` · `create_node_shape` ·
`create_instance` · `set_property_value` · `remove_property_value` ·
`link_resources` · `declare_link` (field-level DB connection — join spec only,
no instance edges) · `delete_resource`.
Operations: `add_sql_source` · `translate_source` · `discover_business_areas` ·
`query_source_data` (federated live fetch — the KG resolves the database).

## Adding a tool

1. Add `{name, description, parameters (JSON Schema), run(args)}` to the defs
   array. Server-side hooks come in through the `federation` object
   (wired in `server/index.mjs`).
2. Writes must be graph-scoped (`c.wrap`) and META-ONLY — instance data belongs
   in SQL, reached via federation.
3. If the tool writes, add its name to `writeTools` in
   `src/components/AgentPanel.tsx` so the UI refreshes after it runs.
4. `pm2 restart studio-server`, then test with a request file as above.

## Proven demo prompts

- Onboarding: "Attach this database and translate its schema: sqlite file <path> (call it x_db). Then connect it to customers by email."
- Lineage: "Which customers have orders shipped but not delivered, and where is each package right now? Use live source data."
- FIBO: "Find every field classified as Monetary Amount and report every monetary value tied to ada@example.com across all systems."
