# Using Ontology Studio

A task-oriented tour. Every flow below works from a fresh connect — pick your
workspace in the top-left (Ask / Model / Govern / Explore / Integrate); it
changes which tabs you see, not what you're allowed to do.

## Orient yourself

- **Connection bar** (top): workspace switcher, endpoint, **graph scope**
  (default = union of all graphs — pick one to focus), acting-as identity,
  Import / Export, ⚙ Settings, ? Help.
- **Left sidebar**: Classes, Shapes, Assets, Taxonomy, Rules, Dashboards,
  Quality, Issues, SQL, Reviews — varies by workspace.
- **Center**: the canvas (or the agent, in the Ask workspace).
- **Right**: Inspector (and the ✦ Agent tab outside Ask).
- **Bottom**: the Query drawer (SPARQL + SQL).

## Model

- **See the schema**: canvas toolbar → ⌂ Overview. Double-click any node to
  expand its neighbors; drag from a node's right handle to another node to
  create a relation. Type a name that matches nothing and Enter **creates**
  that property.
- **Add things**: double-click anything in the sidebar tree to put it on the
  canvas (the viewport centers it). Drag a tree item **onto** a node to link
  the two.
- **Edit instances**: click a node → Inspector shows the SHACL-shaped form.
  No shape yet? Open the class and use "draft a NodeShape" to profile one.
- **Raw Turtle**: canvas toolbar → `{ }` Source. CodeMirror with
  autocomplete; changes apply as a diff, not a wholesale replace.

## Connect data (the semantic layer)

- **Add a database**: SQL tab → add a source (SQLite/DuckDB/Postgres/MySQL
  live; Snowflake/MSSQL/Trino/REST experimental). Then *translate* it — the
  schema becomes classes + shapes + R2RML mappings; **rows stay in the
  database** and resolve live.
- **Browse rows**: Assets → Physical objects → ⊞ on a table. Sort, filter
  (type in the box, Enter applies), click a row to inspect it as a resource.
- **Adjust a mapping**: Assets → Mappings → ✎. Rename predicates, set
  datatypes, add/remove column mappings, edit the subject IRI template.
- **Link across databases**: drop one table onto another's node on the
  canvas → the join-link builder asks which key fields match. No rows are
  copied; traversal resolves at query time.
- **Where did this fact come from?** Any virtual resource's Inspector shows
  a Provenance block: source → table → mapping (opens the editor).

## Vocabularies & reference data

- **Taxonomies**: Taxonomy tab. ＋ Scheme, + top concepts, drag rows to
  re-parent, ✎ rename. ⇪ CSV bulk-imports with validation.
- **Crosswalks**: ⇄ Crosswalk maps this scheme to another — review ranked
  label matches, accept each as `skos:exactMatch`/`closeMatch`/…, or dismiss.
- **Codelists**: give concepts ⊘ deprecate / ↺ reactivate from their row.
  A custom field of kind **Codelist** (⚙ in the Taxonomy toolbar) offers
  only *active* codes in every create form.
- **Auto-tagging**: `POST /api/tag {text}` (or the agent's `tag_text` tool)
  finds concepts mentioned in free text.

## Query

- **Drawer** (bottom): SPARQL against the active scope, or read-only SQL
  against any source. `{{name}}` placeholders grow a values form; saved
  queries keep their defaults, and dashboard widgets substitute them.
- **GraphQL**: `/api/graphql` (SDL at `/api/graphql/sdl`) — generated from
  your shapes, cross-source.
- **Search**: the omnibox (top of Classes tab) is BM25 with facets; watches
  notify you (toast) when new results appear.
- **From Python**: `pip install -e sdk/python` →
  `Studio("http://localhost:7881", user="pat").sparql(...)` — search, GraphQL,
  federation, reconciliation, tagging, crosswalks all wrapped.
- **From a BI tool**: the pg wire facade (set `BI_PORT`) exposes business
  objects as tables to anything that speaks Postgres.

## Govern

- **Identities**: the acting-as picker. Editors can't write governed graphs
  directly — their edits stage into a **proposal**; stewards review the diff
  in the Reviews tab and approve/reject. Drafts are invisible everywhere
  until merged.
- **Lifecycle**: assets move draft → in-review → approved → deprecated
  (role-gated; per-asset-type workflows via `studio:workflow`).
- **Quality**: Quality tab → Run quality checks; every run persists and
  trends as sparklines.
- **Rules**: Rules tab. Triple rules ("every member of X gets …") or SPARQL
  CONSTRUCT rules; ⚡ Materialize derives into the inferred graph, and every
  derived fact can explain itself.
- **History**: every entity's Inspector has a timeline; the whole meta layer
  snapshots to git automatically.

## Ask (the agent)

The Ask workspace puts the agent front and center. It plans across every
connected source via the catalog and acts only through typed tools — create
classes, shapes, instances, links; onboard and translate databases; tag
text. Its writes obey the same governance as yours.

## Settings & extension points

- **⚙ Settings**: which namespaces count as "system" (hidden from the
  Classes tree) — extend or trim the list.
- **Custom asset types**: Assets tab → ＋ New asset type — types are data,
  not code.
- **Custom fields**: ⚙ in the Taxonomy toolbar — text/number/date/pick-list/
  codelist fields become SHACL property shapes every dialog picks up.
- **New connectors**: drop a module exporting `{ meta, create }` into
  `server/connectors/` — it appears in the UI with zero registration.

## API

Everything the UI does is HTTP. Interactive reference: **/api/docs**
(OpenAPI at `/api/openapi.json`). Auth: dev header `X-Studio-User`, API
tokens (`/api/auth/tokens`, admin), or OIDC JWT.
