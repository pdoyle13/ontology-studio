# Ontology Studio

A **virtual semantic layer** and knowledge-graph workbench. React + Oxigraph +
live SQL federation. SHACL-first.

The graph stores **meaning only** — ontology, SHACL shapes, R2RML mappings,
field-level cross-database links, FIBO business alignment. Instance data never
leaves your databases: browsing, traversal, and cross-database questions
resolve live, planned from the graph.

**Why it's different**: VendorA-class virtualization (no-ETL, multi-engine,
tiered caching) with VendorB-class semantics (SHACL contracts, shape-driven
forms, governed mappings) — and because the whole meta layer is queryable RDF,
a conversational agent can plan and answer across every attached database.

## Highlights

- **Attach** SQLite files or PostgreSQL URLs → one-click schema translation to
  classes + SHACL shapes + standard R2RML (governed, in the graph)
- **Browse live** — rowcounts, instance lists, and inspectors are live SQL;
  the canvas walks cross-database links declared at the *field* level
- **Agent** (Grok, typed tools only) — model the ontology, declare links,
  discover FIBO business areas, and answer questions federated across sources
- **SHACL end to end** — shape-driven forms with constrained inputs, shape
  editor, validation overlays, shape generation from data
- **Enterprise caching** — memory + disk tiers with tag-scoped invalidation,
  plus a short-TTL SQL tier
- **Layout engine** — scored auto-layout (crossings/overlaps/compactness),
  straight midpoint-anchored edges

## Docs

| | |
|---|---|
| [Quickstart](docs/quickstart.md) | run it, first five minutes |
| [Architecture](docs/architecture.md) | the meta-only design, request paths, caching, code map |
| [Coverage vs VendorA + VendorB](docs/coverage-VendorA-VendorB.md) | feature audit + known gaps |
| **API** | Swagger UI at `http://localhost:7881/api/docs` · spec at `/api/openapi.json` |
| [ROADMAP](ROADMAP.md) | build log, phase by phase |

## Stack

React 19 · Vite · TypeScript · zustand · @xyflow/react · n3 ·
rdf-validate-shacl · Express · node:sqlite · pg · Oxigraph · Grok (xAI)

```bash
npm install && npm test        # 97 tests
docker compose up -d --build   # full stack on :8890
```
