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
- [ ] Scaffold Vite react-ts, deps (n3, @xyflow/react, zustand)
- [ ] SPARQL client (`src/rdf/sparqlClient.ts`): query (SELECT/ASK json, CONSTRUCT turtle), update, graph-store PUT/POST for bulk load; timeout + error surfaces
- [ ] Connection store + ConnectionBar UI: endpoint presets (Oxigraph localhost), test connection, named-graph picker (enumerate via SELECT DISTINCT ?g)
- [ ] App shell layout: left sidebar (tree/search), center canvas, right inspector, bottom SPARQL drawer. Dark theme.
- [ ] Dev Oxigraph instance for the editor (port 7880, own data dir) — script + README note

### Phase 2 — read path (browse before edit)
- [ ] Class tree sidebar: rdfs:Class/owl:Class list w/ instance counts (SPARQL), subclass hierarchy
- [ ] Search: label/IRI contains search (SELECT w/ FILTER or bif — plain FILTER for Oxigraph)
- [ ] GraphCanvas: drop a resource on canvas → node; expand edges (outgoing/incoming, batched CONSTRUCT); auto-layout (dagre or elk); edge labels = predicate curies
- [ ] ResourcePanel: read-only property sheet for selected node (grouped, prefixed, literals w/ lang/datatype)
- [ ] Prefix management: default set (rdf, rdfs, owl, sh, skos, xsd, dcterms, foaf) + learned from data; curie rendering everywhere

### Phase 3 — write path
- [ ] Edit literals in ResourcePanel (DELETE/INSERT DATA per triple, optimistic UI)
- [ ] Add/remove property values incl. object properties (IRI picker w/ search)
- [ ] Create resource (class picker → mint IRI w/ configurable namespace)
- [ ] Delete resource (with incoming-reference warning)
- [ ] Create/delete edges by drag on canvas
- [ ] Undo/redo (inverse-update stack)

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
