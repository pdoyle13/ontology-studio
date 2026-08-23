# Model workspace — ontologists & data modelers

You own the meaning layer: classes, properties, shapes, taxonomies, and the
rules that derive facts. Nothing you do here copies data — the graph stores
the model; instances stay in their databases.

## Daily surface

- **Canvas** — drag classes/instances from the tree, double-click to expand
  neighbors, drag node-to-node to create a relation (the picker suggests
  object properties by domain/range and your recents). Shift-drag box-select,
  Delete hides from view (never deletes data), right-click for everything
  else. Layouts are scored automatically (crossings/overlap/compactness);
  export the picture as PNG.
- **Class tree** — classes with live instance counts (virtual classes count
  from their databases), search-as-you-type, drag anything to the canvas.
- **Shape forms** — select any resource: the form is generated from its
  class's SHACL shape (order, names, required markers, typed widgets,
  pick-lists, language-tagged text, multi-line). Constraint violations show
  inline before you can save an invalid value.
- **Shape editor** — edit property shapes directly (paths, datatypes,
  cardinality, patterns, enumerations); generate a starter shape from
  existing instance data.
- **Taxonomy tab** — schemes and broader/narrower trees; drag to re-parent,
  drop on the header to promote to top concept; the create dialog carries the
  SKOS built-ins plus every custom field configured in Extensions; CSV import
  with validated preview for bulk loads.
- **Extensions (⚙)** — define custom fields (text, long text, language-
  tagged, number, date, yes/no, pick list) per asset type; they are stored as
  SHACL property shapes, so every dialog, import, and validation sees them
  immediately.

## Rules of the road

- Every write is undoable (Ctrl+Z) and journaled; graph snapshots commit
  automatically for git-level history.
- If your role is `editor` on a governed graph, your changes stage into a
  proposal for steward review instead of applying directly.
- Labels come from `dash:LabelRole` designations on shapes — never fabricate
  `rdfs:label` triples on instance data.
