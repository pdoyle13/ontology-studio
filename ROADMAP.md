# Ontology Studio — visual RDF/ontology editor

**Owner:** Pat Doyle. **Stack:** React 19 + Vite + TS, @xyflow/react (canvas), n3 (RDF parsing), zustand (state), Oxigraph (SPARQL 1.1 store).
**Design stance (Pat's):** SHACL-first. Shapes = the model + validation + data contracts (DASH lineage: shapes drive forms). OWL is an import format, not a reasoning commitment. RDF/SPARQL native, no lock-in.

This file is the loop's working memory. Each /loop iteration: pick the next unchecked item, build it, verify (`npm run build`), check it off with a one-line note, commit.

## Architecture

- `src/rdf/` — pure RDF layer: sparql client, term/prefix utils, turtle import/export (n3)
- `src/state/` — zustand stores: connection, graph model, ui
- `src/components/` — panels: ConnectionBar, GraphCanvas, ResourcePanel (forms), SparqlPanel, ImportDialog, ShapesPanel
- Connector model: any SPARQL 1.1 endpoint (query + update URLs); Oxigraph preset (single URL + /query /update /store conventions). Named-graph aware.
- Data flow: canvas + forms read/write via SPARQL (CONSTRUCT to hydrate, DELETE/INSERT to edit). No client-side full-store mirror; hydrate per-resource / per-neighborhood.

## Phases

### Phase 1 — foundation
- [x] Scaffold Vite react-ts, deps (n3, @xyflow/react, zustand)
- [x] SPARQL client (`src/rdf/sparqlClient.ts`): query (SELECT/ASK json, CONSTRUCT turtle), update, graph-store PUT/POST for bulk load; timeout + error surfaces
- [x] Connection store + ConnectionBar UI: endpoint presets (Oxigraph localhost), test connection, named-graph picker (enumerate via SELECT DISTINCT ?g)
- [x] App shell layout: left sidebar (tree/search), center canvas, right inspector, bottom SPARQL drawer. Dark theme.
- [x] Dev Oxigraph instance for the editor (port 7880, own data dir) — PM2 `studio-oxigraph` (job-pipeline's oxigraph.exe binary), UI dev server PM2 `studio-ui` on http://localhost:5180, Vite proxies /db → 7880. Seeded seed/demo.ttl into graph <https://example.org/graphs/music> (102 triples, music domain + SHACL shapes + a deliberately-invalid album for validation demo)

### Phase 2 — read path (browse before edit)
- [x] Class tree sidebar: class list w/ instance counts (flat, sorted by count; subclass hierarchy = later polish), expandable instance lists
- [x] Search: debounced label/IRI CONTAINS search across scope (src/rdf/queries.ts searchResources)
- [x] GraphCanvas: selecting a resource adds it (auto-connects to nodes already on canvas); double-click expands neighbors (25 cap, radial placement + background type/label hydration); right-click removes; dagre auto-layout button; type-colored borders (hashed hue); minimap + controls; edge labels = predicate curies
- [x] ResourcePanel: read-only property sheet (grouped by predicate, type chips, literals w/ lang/datatype, incoming "Referenced by" section, click-to-navigate)
- [x] Prefix management: PrefixMap w/ defaults + shrink/expand; curie rendering everywhere; namespaces auto-learned from class IRIs (generated prefixes, deduped)

### Phase 3 — write path
- [x] Edit literals in ResourcePanel (inline ✎, replaceTriple = DELETE DATA ; INSERT DATA chain, keeps lang/datatype; smoke-tested on Oxigraph)
- [x] Add/remove property values (hover ✕ per value, + per predicate, "+ Add property" with curie expansion; 'auto' term parsing: IRI/curie/integer/decimal/boolean/date detection)
- [x] Create resource ("+ New instance" on class pages — mints IRI in the class's namespace, window.prompt for now; proper modal = Phase 6 polish)
- [x] Delete resource (confirm dialog includes incoming-reference count; deletes incoming refs too when present)
- [x] Create edges by drag on canvas (drag node handle→node, predicate prompt w/ curie expansion, writes triple + draws edge). Edge deletion = delete the value in inspector (canvas edge-delete gesture = Phase 6 polish)
- [x] Undo/redo (command layer src/rdf/commands.ts + history store; every write records its inverse incl. delete-resource snapshot restore; Ctrl+Z/Ctrl+Y + toolbar buttons)

### Phase 4 — imports/exports + connectors
- [x] Import file: Turtle/N-Triples (n3 parse client-side → graph-store POST in 5000-triple N-Triples chunks); progress bar; target-graph field; discovered prefixes registered into PrefixMap (n-triples POST verified on Oxigraph)
- [x] Import from URL (content-negotiated fetch; RDF/XML detected + rejected with clear message; CORS-dependent)
- [x] Export named graph as Turtle (CONSTRUCT → n3 re-serialize with known prefixes → download)
- [x] Multiple saved connections (localStorage), incl. generic SPARQL endpoints (query URL + optional update URL; Wikidata read-only preset button)
- [ ] JSON-LD + RDF/XML import (via jsonld.js / rdfxml parser) — stretch

### Phase 5 — SHACL (the differentiator)
- [x] ShapesPanel: sidebar Shapes tab lists NodeShapes w/ targetClass + property counts (constraint-sheet rendering of a selected shape = the shape editor item below)
- [x] Shape-driven forms: ResourcePanel renders a Form block per NodeShape targeting the resource's classes — sh:order sorting, sh:name labels, required markers + red missing-value flags (minCount), maxCount hides add, sh:datatype types the input + stamps the literal, sh:class renders an instance dropdown picker. Raw triples collapse into an "All triples" details section. (shacl.ts smoke-tested: AlbumShape → Title/Release year/Artist, min=1 each)
- [x] Shape editor: constraint sheet on any NodeShape page — inline name/datatype/class/minCount/maxCount/order/pattern (bnode-SAFE via DELETE/INSERT WHERE through parent shape + sh:path, verified on Oxigraph); add property shape (minted IRI); remove w/ snapshot undo. All undoable.
- [x] Validation: rdf-validate-shacl client-side over the full CONSTRUCTed scope (shapes+data same graph); Issues tab (severity-colored, click→navigate, conforms banner), red rings on canvas nodes, per-field violation messages in shape forms. Verified: catches seeded InRainbows missing label+releaseYear.
- [x] Generate starter shapes from data: "⚙ Generate shape" on shapeless class pages — profiles predicates (datatype/object-class sampling, observed cardinalities → min/maxCount), mints <Class>Shape + property-shape IRIs, opens the editor. Undoable.

### Phase 6 — polish
- [x] SPARQL drawer: collapsible, textarea editor (Ctrl+Enter run, auto-prepend prefixes toggle), auto-detects SELECT/ASK/CONSTRUCT/UPDATE, result table w/ clickable IRIs, turtle output, update runs + refreshes UI. (codemirror highlight + CONSTRUCT→canvas still open)
- [ ] Canvas niceties: minimap, grouping by class color, save/restore layouts per graph
- [ ] Keyboard palette, empty states, error toasts
- [x] README (feature tour, run instructions, architecture + design choices; screenshots still open); CONSTRUCT→canvas "Show on canvas" button in the SPARQL drawer

### Phase 7 — SQL virtualization layer + agent (Pat, 2026-08-22 afternoon)
- [x] Constrained datatypes: sh:in enums (RDF-list fetch, ordered), min/maxInclusive + pattern + datatype validation BEFORE write, typed widgets (number/date/datetime/boolean/enum), input-invalid styling
- [x] Instance dropdowns: ResourcePicker (searchable, keyboard nav) for adding AND replacing object-property values in shape forms
- [x] SQL datasources (server/index.mjs, port 7881, PM2 studio-server, node:sqlite read-only): attach SQLite files, PRAGMA introspection (tables/columns/FKs/rowcounts), Direct-Mapping-style translation → rdfs:Class + rdf:Property + full SHACL NodeShapes (datatype map INT→integer etc., NOT NULL→minCount, FK→sh:class object property), row materialization (paged 10k, chunked load, FK→object IRIs), read-only SQL console (drawer SPARQL|SQL toggle). E2E-verified on mlb_pbp.db: 6 tables→349 schema triples, games_done→1399 instances queryable in SPARQL.
- [x] Ontology agent (server/agent.mjs + AgentPanel, right-side ✦ Agent tab): Claude (AGENT_MODEL env, default claude-sonnet-5) with sparql_query/sparql_update tools, SHACL-first system prompt (query-before-write, no OWL, mint in user namespace, graph-scoped), tool-trace chips in UI, auto-refresh after agent writes. NEEDS ANTHROPIC_API_KEY in studio-server env (pm2 restart studio-server --update-env); panel shows setup notice until then.
- [ ] Live agent test once ANTHROPIC_API_KEY is provided
- [ ] SQL: Postgres/DuckDB connectors; VIRTUAL (query-time) mapping instead of materialization; incremental re-sync

### Phase 8 — real semantic layer (virtualization + governed-RDF methodology) — 2026-08-22 afternoon loop
- [x] Caching tier: all UI SPARQL reads via server QueryCache (LRU+TTL, X-Cache headers, /api/cache/stats), write invalidation on update/store/materialize/agent-write. Verified MISS→HIT→invalidate→MISS.
- [x] Mappings-as-RDF: translate emits standard R2RML (TriplesMap/logicalTable/subjectMap w/ PK templates/predicateObjectMap, FK IRI templates) into <https://studio.local/graphs/mappings>; materialize emits prov:Activity sync metadata. Governed, queryable, editable in-studio.
- [x] Tests: 55 vitest tests / 6 suites (prefixes, mutations, constraints, translate, cache, r2rml); pure logic extracted to server/translate.mjs. `npm test`.
- [x] Docker: multi-stage Dockerfile (server serves dist w/ SERVE_UI), docker-compose (oxigraph + studio, volumes, env passthrough). Built + smoke-tested live (UI 200, write→cache HIT through containers) then downed — dev stack stays on PM2. Note: host 7878 belongs to the kalshi Oxigraph.

### Phase 9 — SQL connections, Grok agent, cross-DB lineage (Pat, 2026-08-22)
- [x] Driver layer (server/drivers.mjs): SQLite files + PostgreSQL URLs behind one async interface; credentials stripped everywhere they surface; UI kind selector
- [x] Agent → Grok (xAI, OpenAI-format tool loop; GROK_API_KEY in gitignored .env, copied from kalshi; Anthropic fallback) with TYPED tools only — create_class/create_property/create_node_shape/create_instance/set_property_value/remove_property_value/link_resources/link_by_key/delete_resource/get_resource/get_schema_overview/sparql_query(read-only). No raw update SPARQL from the model.
- [x] Source provenance ON INSTANCES: every materialized row stamped studio:fromSource + studio:sourceTable; source nodes carry kind + server descriptor
- [x] LINEAGE DEMO (the end goal, verified live): postgres orders_db (customers/orders) + postgres warehouse_db (warehouses/shipments) + sqlite delivery.db (delivery_events) → one graph; GROK AGENT joined them via link_by_key (order_number↔order_ref, tracking_no↔tracking_ref); one SPARQL walks customer→order→shipment→delivery events with per-hop DB attribution. Demo pg container: studio-pg (port 15432, user postgres/studio). 61 tests green.
- [ ] Lineage path VIEW in UI (one-click trace on canvas); incremental re-sync; agent-run validation loop

### Phase 10 — KG-planned federated data access (Pat, 2026-08-22 evening) — THE END-GOAL DEMO
- [x] server/federation.mjs: the R2RML mappings graph IS the catalog (class→TriplesMap→table/columns/source, subject templates); planSources picks which DBs a request touches; queryClass dispatches guarded live SQL (column whitelist, op whitelist, escaped literals, capped limits) through the right driver and mints IRIs from templates
- [x] link_by_key now RECORDS its join spec in the graph (studio:sourceKeyProperty/targetKeyProperty on the predicate) — cross-DB joins are KG-derived, not re-guessed
- [x] Agent tools get_data_catalog (KG-derived structure incl. cross-DB links + join keys) + query_source_data (federated live fetch; agent never names a database — the catalog resolves it); /api/federate/catalog|plan|query endpoints
- [x] VERIFIED END GOAL: Grok answered "which customers have shipped-but-undelivered orders and where are the packages now" from LIVE data across 4 engines/5 databases — 1 catalog call + 10 chained federated queries, correct answer (Alan Turing / ORD-1004 / TRK-77003 in_transit Cary NC, delivered ORD-1001 excluded), per-fact source attribution. BECAUSE of the knowledge graph.
- [x] Straight midpoint-anchored edges (no bezier cheating); layout engine extracted to src/layout/ package (types/metrics/algorithms/refine/anchors/engine; adapters in store+renderer). 84 tests.

### Phase 11 — docs, agent-first, collaboration, flow view, skills (2026-08-22 evening loop)
- [x] docs/ (architecture · quickstart · coverage) + slim README; OpenAPI 3.1 (19 paths) at /api/openapi.json; Swagger UI at /api/docs
- [x] Agentic-first: right panel opens on "What do you want to do?" intent chips; add_sql_source + translate_source tools — verified: one message attached support_desk.db, translated, linked tickets→customers by email, ran discovery
- [x] WebSocket collaboration: /ws broadcast bus fed by cache invalidation (tag-aware graph-changed events), presence badge, debounced auto-refresh — verified across two browsers + the user's live tab
- [x] Flow view (⛃): data warehouses → business objects (FIBO-area grouped, live rowcounts) → outputs/decisions (studio:Output + studio:consumes meta objects: Order Lineage, Customer 360, Financial Exposure); plural-aware FIBO matching (78 fields, 12/13 classes classified)
- [x] Project skills: .claude/skills/{studio-stack, studio-verify, studio-demo, studio-agent}
- Coverage audit verdicts in docs/coverage.md — gaps remaining then: BI JDBC facade, authn/roles, governance workflows, GraphQL-from-shapes, SKOS editor, versioning

### Phase 12 — workflows, governance, audit, PITR (2026-08-22/23 'do it all' loop)
- [x] Meta-layer-as-code: canonical .nt snapshots of every named graph auto-committed on write (graph/ dir) — ontology versioning via git, observed self-committing
- [x] Governance in-graph: users/roles (admin/steward/editor/viewer), data stewards via studio:governs; permission gates on /db/update, /db/store, agent tools; X-Studio-User identity (dev default pat); seeded pat/sam/quinn; canWrite/canPropose/canReview unit-tested
- [x] Review workflow: proposals (staged adds/dels graphs) draft→submitted→merged/rejected; steward-of-target approval; E2E 10/10 (editor blocked, staged invisible until merge, self-approve denied, audit complete); UI: acting-as picker, Reviews tab w/ +/− diff and role-gated actions, agent propose mode
- [x] Audit: changelog graph (actor/op/graphs/detail/time) on every write + /api/governance/changelog
- [x] Kafka change journal (studio.changes, container studio-kafka :19092): replayable events w/ full mutation payloads; graceful when down
- [x] Backup/PITR: checkpoints (graph dumps + journal offsets) + point-in-time restore (checkpoint + replay up to T) — E2E: A+B restored, post-until C excluded
- [x] Process: .githooks/pre-commit (tests gate, self-demonstrated), .github/workflows/ci.yml (fires when a remote exists), compose kafka service
- Remote still needs: create GitHub repo + git remote add + push (no gh CLI on this machine)

## Log
(one line per iteration: date, what shipped)
- 2026-08-22: FINAL — Playwright E2E smoke (8/8 pass, console clean: connect→browse→shape form→canvas→validation→SPARQL→shape editor). Fixed real bug it caught: SPARQL drawer wasn't graph-scoped (now sends default-graph-uri, or union-default-graph on Oxigraph when no graph picked). Loop wound down; core brief fully delivered.
- 2026-08-22: Polish round 1 — learned prefixes, CONSTRUCT→canvas, full README. Remaining P6: codemirror highlight, canvas layout persistence, keyboard palette, code-split, screenshots.
- 2026-08-22: Phase 5 COMPLETE — shape editor (bnode-safe constraint edits) + generate-shape-from-data. NEXT: Phase 6 polish (learned prefixes, CONSTRUCT→canvas, README, code-split, empty states).
- 2026-08-22: SHACL VALIDATION shipped — sidebar tabs (Classes/Shapes/Issues), rdf-validate-shacl engine, violations overlaid on canvas + forms. Remaining P5: shape editor, generate-shapes-from-data.
- 2026-08-22: SHACL shape-driven forms shipped (shacl.ts + ShapeForm) — the DASH-lineage differentiator. NEXT: shapes panel + validation.
- 2026-08-22: SPARQL drawer + generic-endpoint connectors (Wikidata preset). Phase 4 done except JSON-LD/RDF-XML stretch. NEXT: Phase 5 SHACL (shapes panel, shape-driven forms, validation).
- 2026-08-22: Phase 4 imports/exports — ImportExportDialog (file/URL import w/ progress + prefix learning, Turtle export). Remaining P4: saved generic SPARQL connections UI, JSON-LD/RDF-XML.
- 2026-08-22: Phase 3 COMPLETE — undoable command layer (all writes reversible), drag-to-create edges, Ctrl+Z/Y. Build green.
- 2026-08-22: Write path shipped — mutations.ts (insert/delete/replace/create/deleteResource + term parsing), full inline editing in inspector. Write round-trip smoke-tested (insert 204 → ASK true → chained delete 204). Remaining Phase 3: drag-to-create edges, undo/redo.
- 2026-08-22: Graph canvas shipped (react-flow + dagre) — Phase 2 complete except learned-prefix registration. Build green (469kB bundle).
- 2026-08-22: Phase 2 read path (minus canvas) — queries.ts (scoped class/instance/search/describe), graph store, ClassTree w/ search, ResourcePanel w/ incoming refs + navigation. Class query smoke-tested on live Oxigraph. Build green.
- 2026-08-22: Phase 1 complete — scaffold, SPARQL client, connection bar w/ graph picker, dark shell, Oxigraph:7880 under PM2 (studio-oxigraph + studio-ui), demo seed loaded, build green, first commit.
