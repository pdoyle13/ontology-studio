# Ontology Studio

A visual RDF / ontology editor. React + Oxigraph, SHACL-first.

Browse, edit, and validate RDF the way it should work: **shapes are the model**. SHACL drives the forms, the validation, and the data contract — classes and instances get shape-driven editing (the VendorB/DASH pattern), and anything without a shape can have one generated from its data.

## Feature tour

- **Connections** — any SPARQL 1.1 endpoint. Oxigraph preset (query/update/graph-store in one), generic endpoints with optional update URL (blank = read-only), Wikidata one-click preset. Saved in localStorage. Named-graph picker with triple counts.
- **Browse** — class tree with instance counts, global search, resource inspector with grouped properties, incoming references, click-through navigation on every IRI. Curie rendering everywhere; namespaces are learned from the data automatically.
- **Canvas** — select a resource to place it; double-click to expand its neighborhood; drag between nodes to create a triple (predicate prompt); right-click to remove; dagre auto-layout; type-colored nodes; minimap.
- **Edit** — inline literal editing, add/remove values, add properties (curie + auto-typed values), create instances, delete resources (with incoming-reference handling). **Every write is undoable** (Ctrl+Z / Ctrl+Y) — the command layer records the SPARQL inverse of each operation, including full-snapshot restore for resource deletion.
- **SHACL**
  - *Forms*: resources whose class has a `sh:NodeShape` render a form built from the shape — `sh:order`, `sh:name`, required markers (`minCount`), capped adds (`maxCount`), datatype-typed inputs, instance dropdowns for `sh:class`.
  - *Editor*: open a NodeShape and edit constraints inline (name/datatype/class/cardinality/order/pattern). Works on blank-node property shapes (edits address them via parent shape + `sh:path`).
  - *Generate*: profile a class's instance data → draft a starter shape (observed datatypes, object classes, cardinalities).
  - *Validate*: run `rdf-validate-shacl` over the active scope; violations appear in the Issues tab, as red rings on canvas nodes, and as per-field messages in forms.
- **SPARQL drawer** — run SELECT/ASK/CONSTRUCT/UPDATE against the active connection; result tables with clickable IRIs; CONSTRUCT results can be thrown onto the canvas.
- **Import / Export** — Turtle/N-Triples from file or URL, parsed client-side (syntax errors surface before upload), loaded in 5,000-triple chunks with progress; prefixed Turtle export of any graph.

## Run it

```bash
npm install
npm run dev            # UI on http://localhost:5180
```

The dev server proxies `/db/*` to a local Oxigraph on port 7880:

```bash
oxigraph serve --location .oxigraph-data --bind 127.0.0.1:7880
```

Seed the demo dataset (music domain + shapes + one deliberately-invalid resource):

```bash
curl -X POST "http://localhost:7880/store?graph=https%3A%2F%2Fexample.org%2Fgraphs%2Fmusic" \
  -H "Content-Type: text/turtle" --data-binary @seed/demo.ttl
```

Then: connect to **Local Oxigraph (studio)**, pick the `music` graph, open the **Issues** tab and hit *Run SHACL validation* — it will flag the album missing its required title and release year. Fix it in the shape-driven form; watch the issues clear.

## Architecture

```
src/rdf/       pure RDF layer — no React
  sparqlClient   SPARQL 1.1 protocol (query/update/graph-store), typed errors
  queries        scope-aware reads: classes, instances, search, describe
  mutations      single-triple writes, term parsing/serialization
  commands       undoable command wrappers (each write carries its inverse)
  shacl          shape reading (by class, by IRI), datatype→widget mapping
  shapeGen       shape authoring: bnode-safe constraint edits, data profiling
  importExport   n3 parse/serialize, chunked graph-store upload
  prefixes       curie registry, namespace learning
src/state/     zustand stores: connection, graph, canvas, history, validation
src/components/  ConnectionBar, SidebarTabs (Classes/Shapes/Issues), GraphCanvas,
                 ResourcePanel, ShapeForm, ShapeEditor, SparqlDrawer, ImportExport
```

Design choices worth knowing:

- **No client-side store mirror.** The endpoint is the source of truth; the UI hydrates per-resource neighborhoods via SPARQL. Scales to graphs the browser can't hold.
- **Graph-scope aware.** Every query runs against the selected named graph, or the union of default + all named graphs when none is picked.
- **Writes are surgical.** Single-triple `DELETE DATA`/`INSERT DATA` (chained for replace), so concurrent editors don't stomp each other and undo is exact.
- **Validation is client-side** over a CONSTRUCT of the scope — works against any endpoint, including ones you can't install anything on. (A server-side CI lane with pySHACL over exported Turtle is the natural companion.)

## Stack

React 19 · Vite · TypeScript · zustand · @xyflow/react + dagre (canvas) · n3 (RDF I/O) · rdf-validate-shacl · Oxigraph
