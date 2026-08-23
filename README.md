# YAOE — yet another ontology editor

In the proud lineage of YASGUI and YATE: an unassuming name for an ambitious
tool. MIT-licensed; commercial support and integration consulting available
from the author.

A **virtual semantic layer** and knowledge-graph workbench. React + Oxigraph +
live SQL federation. SHACL-first.

The graph stores **meaning only** — ontology, SHACL shapes, R2RML mappings,
field-level cross-database links, FIBO business alignment. Instance data never
leaves your databases: browsing, traversal, and cross-database questions
resolve live, planned from the graph.

**Why it's different**: no-ETL, multi-engine SQL virtualization with real
semantics — SHACL contracts, shape-driven forms, governed R2RML mappings —
and because the whole meta layer is queryable RDF, a conversational agent can
plan and answer across every attached database.

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

## Setup

**Prerequisites**: Node 22+, Docker (for Oxigraph + Kafka), git.

```bash
git clone <this repo> && cd ontology-studio
npm ci
docker compose -f docker-compose.yml -f .devcontainer/compose.dev.yml up -d oxigraph kafka
cp .env.example .env        # add GROK_API_KEY (or ANTHROPIC_API_KEY) for the agent
npm run dev                 # UI on :5180, API on :7881
```

Open http://localhost:5180, pick the endpoint, and load the demo:
the SQL tab attaches `seed/*.db` files; "Translate" turns any attached
database into classes + shapes + R2RML in one click.

**Production**: `docker compose up -d` (everything in containers, UI+API on
:8890) or pull the GHCR image — see docs/quickstart.md → Deployment.

**Tests**: `npm test` (vitest; the pre-commit hook runs them too).

## Docs

| | |
|---|---|
| [Quickstart](docs/quickstart.md) | run it, first five minutes |
| [Architecture](docs/architecture.md) | the meta-only design, request paths, caching, code map |
| [Capability coverage](docs/coverage.md) | feature audit + known gaps |
| **API** | Swagger UI at `http://localhost:7881/api/docs` · spec at `/api/openapi.json` |
| [Workspaces & asset types](docs/workspaces.md) | per-persona entry points; dynamic asset-type framework |
| [Personas](docs/personas/) | per-workspace guides: modeler, steward, explorer, developer, admin |
| [Parity plan](docs/parity-plan.md) | the phased path to full platform coverage |
| [ROADMAP](ROADMAP.md) | build log, phase by phase |

## Stack

React 19 · Vite · TypeScript · zustand · @xyflow/react · n3 ·
rdf-validate-shacl · Express · node:sqlite · pg · Oxigraph · Grok (xAI)

```bash
npm install && npm test        # 97 tests
docker compose up -d --build   # full stack on :8890
```
