# Workspaces & asset types

One deployment, one build, several front doors — workspaces are UX presets,
not product editions or license tiers. Every persona gets a surface whose
navigation, default panels, and permissions match their job — all driven by
the same graph and the same role model (`admin` / `steward` / `editor` /
`viewer`).

## Workspaces

| Workspace | Who | Landing surface | Primary tools |
|---|---|---|---|
| **Ask** | everyone | conversational "What do you want to do?" | agent with typed tools, omnibox |
| **Model** | ontologists, data modelers | canvas + class tree | shapes, taxonomy, rules, extensions |
| **Govern** | data stewards | review queue | proposals, changelog, quality metrics, user/role admin |
| **Explore** | analysts, business users | search + saved views | omnibox, data grid, flow view, dashboards (read-only + propose) |
| **Integrate** | developers | API console | Swagger, SPARQL/SQL drawers, GraphQL, ES `_search`, connectors |

Selection: `?workspace=` URL param, remembered per user; the default follows
the acting user's role (steward → Govern, viewer → Explore, editor → Model,
admin → Integrate). A switcher lives in the connection bar.

Mechanically a workspace is a preset: which sidebar tabs show, which right
panel opens first, which toolbar actions render, and whether write actions
surface at all. No feature is exclusive — a workspace is a lens, not a wall;
permissions stay enforced server-side by role, exactly as today.

## Asset types

Everything a user manages is an **asset** of some type. An asset type is
*data, not code*: a record in the extensions graph declaring

- the RDF class (`skos:ConceptScheme`, `studio:Glossary`, …),
- the SHACL node shape driving its create dialog, forms, and validation,
- the label property (`dash:LabelRole` designation),
- the workspace(s) and sidebar section it appears under,
- its list/tree presentation (flat list, broader/narrower tree, table),
- optional lifecycle states used by governance workflows.

### Built-in asset types

| Type | Backed by | Purpose |
|---|---|---|
| **Ontology** | `rdfs:Class` + shapes per named graph | the logical model |
| **Taxonomy** | `skos:ConceptScheme`/`skos:Concept` | hierarchical vocabularies |
| **Business glossary** | `studio:Glossary` + `skos:Concept` (flat, definition-first) | agreed business terms with stewards |
| **Business object** | classes aligned to business areas (FIBO alignment graph) | the enterprise's logical entities across sources |
| **Physical object** | introspected tables/columns from attached sources | the physical data model as first-class, searchable assets |
| **Mapping** | R2RML TriplesMaps in the mappings graph | physical→logical bindings, browsable and governable like any asset |

### Custom asset types

The Extensions configurator (the same place that defines custom fields today)
gains a "New asset type…" flow: name it, pick or mint its class, define its
fields (which become the node shape), choose its presentation and workspace
placement. The new type immediately gets: a sidebar entry, the shared create
dialog, spreadsheet import, search indexing, governance/proposals, and API
exposure — because all of those are driven by shapes and the type registry,
not per-type code.
