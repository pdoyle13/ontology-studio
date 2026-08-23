# Feature coverage: VendorA + VendorB

Goal: cover VendorA's virtualization feature set and the core of VendorB's
governance feature set — in one tool, on open standards.

## vs VendorA (SQL virtual semantic layer)

| VendorA capability | Studio status | Notes |
|---|---|---|
| Ontology over SQL sources, no ETL | ✅ | schema translation → classes/properties; instances stay in SQL |
| Virtual queries (no data movement) | ✅ | virtual instance layer + federation; live SELECTs, guarded |
| Multiple engines | ✅ partial | PostgreSQL + SQLite today; driver interface ready for MySQL/Snowflake/etc. |
| Data virtualization across databases | ✅ | field-level link declarations; joins resolved at query time |
| Multi-tier caching | ✅ | memory LRU + persistent disk + SQL result tier, tag-scoped invalidation |
| SQL access for consumers | ✅ | read-only SQL console per source; federation API |
| Inheritance / IS-A | ✅ | `rdfs:subClassOf` (and real reasoning is available via SPARQL, unlike VendorA) |
| Text-to-query for AI | ✅ stronger | Grok agent plans from the KG catalog — it federates, not just text-to-SQL |
| Governed mapping | ✅ stronger | mappings are standard **R2RML in the graph** (VendorA's are opaque product state) |
| Column→business meaning | ✅ stronger | FIBO auto-discovery writes queryable alignments |
| BI tool connectors (Tableau/PowerBI JDBC) | ❌ gap | would need a JDBC/ODBC facade — out of scope for now |
| Row-level security / roles | ❌ gap | no authn/authz yet |

## vs VendorB EDG (RDF governance platform)

| VendorB capability | Studio status | Notes |
|---|---|---|
| SHACL-native modeling | ✅ | shapes are the contract; shape editor with bnode-safe constraint edits |
| Shape-driven forms (DASH) | ✅ | `sh:order`/`sh:name`/datatypes/cardinality/`sh:in`; `dash:LabelRole` labels |
| Validation | ✅ | client-side rdf-validate-shacl; violations on forms + canvas + Issues tab |
| Ontology authoring UI | ✅ | classes, properties, instances (meta), undo/redo on every write |
| Generate model from data | ✅ | shape generation from instance profiles; schema translation from SQL |
| Taxonomies (SKOS) | ⚠ partial | SKOS prefixes/labels supported; no dedicated taxonomy editor |
| Governance workflows (roles, approvals, versioning) | ❌ gap | no workflow engine; git-style graph versioning would be the studio-native answer |
| Reference/master data management | ⚠ partial | instances-as-meta editing exists; no stewardship workflows |
| GraphQL from shapes | ❌ gap | natural next step given shapes are first-class |
| Import/export (Turtle, N-Triples) | ✅ | file + URL import, prefixed export; JSON-LD/RDF-XML still open |

## The combined pitch

VendorA virtualizes but has no real semantics (no SHACL, opaque mappings,
IS-A-only reasoning). VendorB governs but doesn't virtualize SQL estates.
The studio does both **because the mapping, the links, and the business
vocabulary are themselves governed RDF** — which is also exactly what makes an
AI agent able to plan across the whole estate.

Known gaps worth building next: BI connector facade, authn/roles,
GraphQL-from-shapes, SKOS taxonomy view, graph versioning.
