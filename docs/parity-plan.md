# Parity plan — COMPLETE (2026-08-23)

All thirteen loops below shipped, each verified by unit tests + browser E2E
before its commit. Remaining known follow-ups: live-endpoint validation for
the experimental connectors (Snowflake, SQL Server, Trino) and graph-store
adapters (GraphDB, Stardog, Neptune); extended-protocol support in the BI
facade; OIDC against a production IdP.

The phased path to full coverage of the commercial semantic-layer,
ontology-governance, and knowledge-graph-platform feature sets — plus the
studio's own differentiators. Each loop is sized for one focused iteration
cycle and ends verified (unit + E2E) like every loop so far.

Already banked: virtual SQL layer + federation, SHACL forms/validation/
generation, taxonomy editor with extensions + CSV import, governance
proposals + audit + PITR, Kafka journal, graph-as-code, GraphQL-from-shapes,
BM25 search with ES/OpenSearch wire compatibility, pluggable connector
registry (sqlite/duckdb/postgres/mysql/snowflake-exp), agent with typed
tools, WebSocket collaboration, Docker/GHCR/Codespaces deployment.

## Loop plan

**L1 — Workspaces & entry points** *(foundation for everything user-facing)*
Workspace presets (Ask / Model / Govern / Explore / Integrate) per
docs/workspaces.md: URL param + per-role default + connection-bar switcher;
sidebar tabs, default panels, and toolbar actions filtered per workspace.
Read-only hardening for Explore (viewer).

**L2 — Asset-type framework** *(the platform move)*
Type registry in the extensions graph: class + node shape + label role +
placement + presentation, read by the sidebar, create dialog, importer,
search, and APIs. Built-ins shipped on it: **Business glossary**,
**Business object**, **Physical object** (introspected tables/columns as
assets), **Mapping** (R2RML browsable/governable). "New asset type…" flow
in Extensions. The taxonomy tab becomes the tree *presentation* of this
framework rather than special-cased code.

**L3 — SHACL-AF rules engine**
Rule authoring (sh:TripleRule / sh:SPARQLRule) as first-class shapes;
materialization worker with per-derived-triple provenance (rule + bindings);
derived-vs-asserted toggle in tree/canvas; rule-driven consistency checks in
Issues. No OWL.

**L4 — Spreadsheet import wizard (all asset types)**
Generalize the taxonomy CSV pipeline: any asset type, header→field mapping
UI with saved mapping templates, validated preview, batch undo. XLSX via
sheet→CSV conversion.

**L5 — Page & dashboard builder**
Wizard: pick a saved query (SPARQL/SQL/GraphQL) → pick a component (table,
bar, line, pie, KPI, graph view) → place on a grid page. Pages stored in the
graph, shareable, live against the virtual layer, visible in Explore.
Chart rendering with a lightweight chart lib; parameterized saved queries.

**L6 — Graph-store abstraction (Stardog · Neptune · GraphDB)**
Extract the Oxigraph specifics (union-default-graph param, /store loading,
graph enumeration) behind a `graphStore` interface with per-backend adapters
(SPARQL 1.1 protocol + graph-store protocol, vendor auth, named-graph
listing). Config: `GRAPH_STORE_URL` + `GRAPH_STORE_KIND`. CI matrix against
GraphDB Free + Oxigraph containers.

**L7 — Connector wave 2 + BI facade**
SQL Server, BigQuery, Trino/Databricks connectors on the registry (each ~a
file); validate Snowflake against a live account. **BI facade**: PostgreSQL
wire-protocol server exposing business objects as tables (semantic SQL), so
Tableau/Power BI/Looker connect with their stock Postgres driver.

**L8 — Search 2.0**
Facets (by type/source/business area) in the omnibox and an Explore search
page; highlights; parameterized saved searches; watches → notifications.

**L9 — Workflows & notifications**
Configurable state machines per asset type (states/transitions/required
roles declared in the graph); watches + WS/email digests; per-entity history
timeline fed by the Kafka journal; entity comment threads.

**L10 — Enterprise authn & observability**
OIDC SSO + API tokens replacing the dev identity header; per-graph ACL
matrix; Prometheus `/metrics` + OTLP/Datadog trace-and-metric export
(request latency, cache hit rates, federation fan-out, journal lag).

**L11 — Entity linking & quality**
W3C Reconciliation API endpoint (spreadsheet import gains "match to existing
assets"); crosswalk asset type with agent-suggested mappings; persisted data
quality metrics + trend dashboards from scheduled validation runs.

**L12 — Interchange polish**
JSON-LD export; usage panel (everything referencing an IRI across graphs);
metrics dashboard; rename-IRI refactor across graphs; deprecation flags.

**L13 — Raw RDF source editing (RDF 1.2)**
A source view on any named graph: edit as Turtle/TriG text with live parse
validation, then apply as a computed diff (delete removed triples, insert
added ones — undoable, journaled, proposal-aware) rather than wipe-and-load.
RDF 1.2 constructs supported end to end: triple terms / reifiers
(RDF-star syntax), directional language tags, version-aware serialization.
Depends on Oxigraph's RDF 1.2 support level — verify and pin; N3.js handles
the star syntax client-side.

## Sequencing

L1 → L2 unlock most UI work and should land first. L3, L4, L6, L7 are
independent of each other after L2. L5 wants L4's parameterized queries but
can start on saved queries as-is. L8–L13 in any order; L10 before any real
multi-user deployment. L13 is standalone.
