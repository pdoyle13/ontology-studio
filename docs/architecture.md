# Architecture

Ontology Studio is a **virtual semantic layer**: the graph stores meaning, the
databases keep the data, and everything in between is resolved at query time.

```
┌─────────────┐   ┌──────────────────────────────┐   ┌──────────────────────┐
│  React UI   │──▶│  studio-server (:7881)       │──▶│  Oxigraph (:7880)    │
│  (:5180)    │   │  · caching tiers (mem+disk)  │   │  META LAYER ONLY:    │
│  canvas /   │   │  · SQL drivers (pg, sqlite)  │   │  classes · shapes    │
│  forms /    │   │  · virtual instance layer    │   │  R2RML mappings      │
│  agent chat │   │  · federation planner        │   │  field-level links   │
└─────────────┘   │  · FIBO discovery            │   │  FIBO + alignment    │
                  │  · Grok agent loop           │   └──────────────────────┘
                  └──────┬───────────────────────┘
                         │ live SQL (never copied)
        ┌────────┬───────┴──┬──────────┬─────────────┐
        │ crm_db │ sales_db │ wms_db … │ delivery.db │   ← many engines
        └────────┴──────────┴──────────┴─────────────┘
```

## The one rule

**Only the meta layer lives in the graph.** Instance rows are never
materialized. Cross-database relationships are declared **field-level** — a
predicate plus the two join-key properties — and instance joins happen live.

## Layers

| Layer | Where | What |
|---|---|---|
| Ontology | Oxigraph | `rdfs:Class` / `rdf:Property`, humanized labels |
| Contracts | Oxigraph | SHACL NodeShapes (drive forms, validation, label roles via `dash:LabelRole`) |
| Mappings | Oxigraph (`graphs/mappings`) | R2RML TriplesMaps: table→class, column→property, PK subject templates, FK IRI templates, source descriptors, sync provenance |
| Business vocabulary | Oxigraph (`graphs/fibo`) | curated FIBO classes with areas + matcher keywords (`skos:altLabel`) |
| Alignment | Oxigraph (`graphs/alignment`) | `studio:businessConcept` per field — written by auto-discovery |
| Links | active graph | field-level connections: predicate + `studio:sourceKeyProperty`/`targetKeyProperty` |
| Instances | **SQL sources** | fetched live via the virtual layer / federation |
| Taxonomies | active graph | SKOS schemes/concepts edited in the Taxonomy tab |
| Saved queries | Oxigraph (`graphs/queries`) | named SPARQL/SQL snippets (journaled like all graphs) |

## Request paths

- **Browse / inspect** — UI → `/api/virtual/*` → catalog (from mappings graph) →
  owning driver → live `SELECT`, IRIs minted from R2RML subject templates,
  links traversed from declared join keys (forward and reverse).
- **SPARQL** — UI → `/db/query` (caching passthrough) → Oxigraph. Meta-layer
  questions only; instance questions belong to federation.
- **Federation** — `queryClass(classIri, filters)` → catalog resolves the owning
  database → guarded SQL (column/op whitelists, escaped literals, capped).
- **Agent** — Grok with typed tools only: schema/catalog reads, ontology
  authoring (classes/shapes/instances in the *meta* sense), `declare_link`,
  `query_source_data`, `graphql_query`, `discover_business_areas`. It never
  writes raw SPARQL updates and never inserts instance data into the graph.
- **Search** — embedded BM25 inverted index over the whole estate (model
  terms + live rows via the catalog, LabelRole labels), rebuilt debounced on
  graph invalidation. Wire-compatible ES/OpenSearch surface under `/es`
  (cluster info, `_search` query DSL, `_cat/indices`, `_refresh`); set
  `SEARCH_URL` to bulk-push and proxy to a real cluster instead. The omnibox
  reads `/api/search`.
- **GraphQL** — `POST /api/graphql` (`GET /api/graphql/sdl` for the SDL).
  SHACL node shapes generate the schema; resolvers answer from live SQL for
  virtual classes and from the graph for meta classes. The schema memo is
  invalidated by any graph change.

## Graph-store backends

`server/core/graphStore.mjs` abstracts the triplestore. Oxigraph is the
default and the one exercised in CI; adapters for **GraphDB**
(`http://host:7200/repositories/<repo>`), **Stardog**
(`http://host:5820/<db>`), and **Neptune** (`https://host:8182`) encode each
vendor's query/update URL layout, union-default-graph mechanism, basic auth,
and Graph Store Protocol availability (Neptune/Stardog loads fall back to
chunked `INSERT DATA`). Configure with `GRAPH_STORE_KIND` + `GRAPH_STORE_URL`
(+ `GRAPH_STORE_USER`/`GRAPH_STORE_PASSWORD`). Every meta-layer read/write in
`core/meta.mjs` routes through it; the non-Oxigraph adapters are written to
vendor protocol docs and still need live-endpoint validation.

## Caching (see `server/cache.mjs`)

| Tier | Scope | TTL | Invalidation |
|---|---|---|---|
| T1 memory LRU | SPARQL reads via `/db/query` | 60s | tag-scoped by graph |
| T2 disk | same entries, survives restarts | 10m | tag-scoped by graph |
| SQL results | federation + virtual reads | 15s | tagged per source |
| Catalog memo | R2RML catalog + alignment | 5m | any invalidation |

Writes name their graphs (`GRAPH <g>` in updates, `?graph=` on store) and evict
only entries tagged with those graphs; unscoped entries (`*`) fall on any write.

## Code map

```
src/rdf/        client RDF layer (sparql client, queries, mutations, commands,
                shacl, constraints, prefixes, display, virtualApi, import/export)
src/state/      zustand stores: connection, graph, canvas, history, validation
src/layout/     pure layout engine (algorithms, metrics, refine, anchors)
src/components/ ConnectionBar, SidebarTabs, ClassTree, GraphCanvas, ResourcePanel,
                ShapeForm, ShapeEditor, SparqlDrawer, SqlPanel, AgentPanel,
                DataGrid, Omnibox, TaxonomyPanel, ProposalsPanel, …
server/
  index.mjs     routes + wiring (the only place endpoints live)
  connectors/   pluggable SQL drivers (registry auto-discovers drop-in modules)
  core/         meta (shared sparql), cache tiers
  semantic/     translate, r2rml, federation, virtual, discover, graphqlLayer
  search/       searchIndex (BM25 + ES DSL), searchService (estate crawler)
  governance/   governance (roles/proposals), changelog
  agent/        agent loop, typed tools
  ops/          eventBus (Kafka), backup (PITR), graphAsCode, openapi
seed/           demo data: music ontology, FIBO core, sqlite databases
```
