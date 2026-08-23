# Capability coverage

Audited against the feature sets of commercial SQL-virtualization
platforms and RDF ontology-governance platforms.

Goal: full SQL-virtualization coverage plus the core of an ontology
governance platform — in one tool, on open standards.

## SQL virtualization / semantic data layer

| Capability | Studio status | Notes |
|---|---|---|
| Ontology over SQL sources, no ETL | ✅ | schema translation → classes/properties; instances stay in SQL |
| Virtual queries (no data movement) | ✅ | virtual instance layer + federation; live SELECTs, guarded |
| Multiple engines | ✅ partial | PostgreSQL + SQLite today; driver interface ready for MySQL/Snowflake/etc. |
| Data virtualization across databases | ✅ | field-level link declarations; joins resolved at query time |
| Multi-tier caching | ✅ | memory LRU + persistent disk + SQL result tier, tag-scoped invalidation |
| SQL access for consumers | ✅ | read-only SQL console per source; federation API |
| Inheritance / IS-A | ✅ | `rdfs:subClassOf` (and richer reasoning is available via SPARQL) |
| Text-to-query for AI | ✅ stronger | agent plans from the KG catalog — it federates, not just text-to-SQL |
| Governed mapping | ✅ stronger | mappings are standard **R2RML in the graph** — governed and queryable, never opaque product state |
| Column→business meaning | ✅ stronger | FIBO auto-discovery writes queryable alignments |
| BI tool connectors (Tableau/PowerBI JDBC) | ❌ gap | would need a JDBC/ODBC facade — out of scope for now |
| Row-level security / roles | ⚠ partial | role model (admin/steward/editor/viewer) gates writes; no row-level filters or real authn |
| Live data grid over sources | ✅ | sortable/filterable/paged table per virtual class, KG-planned SQL shown inline |

## RDF modeling & governance

| Capability | Studio status | Notes |
|---|---|---|
| SHACL-native modeling | ✅ | shapes are the contract; shape editor with bnode-safe constraint edits |
| Shape-driven forms (DASH) | ✅ | `sh:order`/`sh:name`/datatypes/cardinality/`sh:in`; `dash:LabelRole` labels |
| Validation | ✅ | client-side rdf-validate-shacl; violations on forms + canvas + Issues tab |
| Ontology authoring UI | ✅ | classes, properties, instances (meta), undo/redo on every write |
| Generate model from data | ✅ | shape generation from instance profiles; schema translation from SQL |
| Taxonomies (SKOS) | ✅ | Taxonomy tab: scheme picker, broader/narrower tree, drag re-parent, drop-to-promote, rename — all undoable |
| Governance workflows (roles, approvals, versioning) | ✅ | proposals with staged diffs, steward-of-target review, merge/reject audit trail; graph-as-code snapshots + Kafka journal + checkpoint PITR |
| Reference/master data management | ⚠ partial | stewardship via `studio:governs` + proposal review; no match/merge tooling |
| GraphQL from shapes | ✅ | `/api/graphql` + SDL: types from NodeShapes; virtual classes resolve via live SQL, meta classes from the graph |
| Import/export (Turtle, N-Triples) | ✅ | file + URL import, prefixed export; JSON-LD/RDF-XML still open |

## The combined pitch

SQL virtualization products have no real semantics (no SHACL, opaque
mappings, IS-A-only reasoning). Ontology governance products don't
virtualize SQL estates. The studio does both **because the mapping, the
links, and the business vocabulary are themselves governed RDF** — which is
also exactly what makes an AI agent able to plan across the whole estate.

## Exploration & interaction

| Capability | Studio status |
|---|---|
| Unified keyword search (omnibox) | ✅ Ctrl+K over model terms + live rows in every database |
| Saved queries | ✅ named SPARQL/SQL snippets persisted in `graphs/queries` |
| Canvas exploration | ✅ drag-drop, context menus, drag-to-relate, box-select, Delete-to-hide, PNG export |
| Collaborative editing | ✅ WebSocket graph-change broadcasts + presence |
| Conversational entry point | ✅ agent-first panel with typed tools incl. `graphql_query` |

Known gaps worth building next: BI connector facade (JDBC/ODBC), real authn,
row-level security, SKOS match/merge stewardship, JSON-LD / RDF-XML export.
