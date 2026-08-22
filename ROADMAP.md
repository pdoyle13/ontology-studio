# Ontology Studio — visual RDF/ontology editor

**Owner:** Pat Doyle. **Stack:** React 19 + Vite + TS, @xyflow/react (canvas), n3 (RDF parsing), zustand (state), Oxigraph (SPARQL 1.1 store).
**Design stance (Pat's):** SHACL-first. Shapes = the model + validation + data contracts (VendorB/DASH lineage: shapes drive forms). OWL is an import format, not a reasoning commitment. RDF/SPARQL native, no lock-in.

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
- [x] Prefix management: PrefixMap w/ defaults + shrink/expand; curie rendering in tree + panel (learned-from-data registration still TODO)

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
- [ ] README with screenshots; demo dataset seed script

## Log
(one line per iteration: date, what shipped)
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
