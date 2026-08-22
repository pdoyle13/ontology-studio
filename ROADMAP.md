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
- [ ] Import file: Turtle/N-Triples (n3 parse client-side → graph-store POST in chunks); progress UI
- [ ] Import from URL (fetch → same path); content-negotiation
- [ ] Export named graph as Turtle (CONSTRUCT, prefixed serialization via n3 Writer)
- [ ] Multiple saved connections (localStorage), incl. generic SPARQL endpoints (Wikidata read-only demo)
- [ ] JSON-LD + RDF/XML import (via jsonld.js / rdfxml parser) — stretch

### Phase 5 — SHACL (the differentiator)
- [ ] ShapesPanel: list sh:NodeShapes, targetClass, property shapes rendered as a constraint sheet
- [ ] Shape-driven forms: when a resource's class has a NodeShape, ResourcePanel renders from the shape (order, datatype widgets, minCount required markers) — the DASH pattern
- [ ] Shape editor: add/edit property shapes (path, datatype/class, cardinality, in-list) via forms
- [ ] Validation: run client-side (rdf-validate-shacl or shacl-engine) against hydrated data or server-side lane; violations overlaid on canvas + forms
- [ ] Generate starter shapes from data (profile a class: predicates, datatypes, cardinalities observed)

### Phase 6 — polish
- [ ] SPARQL drawer: editor w/ syntax highlight (codemirror), result table, CONSTRUCT→canvas
- [ ] Canvas niceties: minimap, grouping by class color, save/restore layouts per graph
- [ ] Keyboard palette, empty states, error toasts
- [ ] README with screenshots; demo dataset seed script

## Log
(one line per iteration: date, what shipped)
- 2026-08-22: Phase 3 COMPLETE — undoable command layer (all writes reversible), drag-to-create edges, Ctrl+Z/Y. Build green.
- 2026-08-22: Write path shipped — mutations.ts (insert/delete/replace/create/deleteResource + term parsing), full inline editing in inspector. Write round-trip smoke-tested (insert 204 → ASK true → chained delete 204). Remaining Phase 3: drag-to-create edges, undo/redo.
- 2026-08-22: Graph canvas shipped (react-flow + dagre) — Phase 2 complete except learned-prefix registration. Build green (469kB bundle).
- 2026-08-22: Phase 2 read path (minus canvas) — queries.ts (scoped class/instance/search/describe), graph store, ClassTree w/ search, ResourcePanel w/ incoming refs + navigation. Class query smoke-tested on live Oxigraph. Build green.
- 2026-08-22: Phase 1 complete — scaffold, SPARQL client, connection bar w/ graph picker, dark shell, Oxigraph:7880 under PM2 (studio-oxigraph + studio-ui), demo seed loaded, build green, first commit.
