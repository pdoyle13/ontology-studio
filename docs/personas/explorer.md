# Explore workspace — analysts & business users

You want answers, not modeling tools. Everything here is read-only against
live data; if something looks wrong you can propose a change without being
able to break anything.

## Daily surface

- **Ask the agent** — plain-language questions ("which customers have shipped
  but undelivered orders?"). The agent plans from the knowledge-graph catalog,
  queries the right databases live, and answers with per-fact source
  attribution. You never need to know which database holds what — that is
  the point of the graph.
- **Omnibox (Ctrl+K)** — one search box over everything: business terms,
  classes, and live rows in every connected database, ranked together.
  Pick a hit to open its record.
- **Data grid** — spreadsheet-style live view of any business object:
  sortable columns, per-column filters, paging; every interaction is a fresh
  guarded query against the owning database (the SQL is shown in the footer).
- **Record view** — any row or term opens as a record: its fields, plus
  linked records across databases (order → shipment → delivery events),
  resolved live at click time.
- **Flow view (⛃)** — the big picture: data warehouses → business objects →
  outputs/decisions, with live row counts.
- **Saved queries** — reusable questions saved by you or shared by the team,
  runnable in one click.
- **Dashboards** *(planned — see parity plan)* — chart/KPI pages built from
  saved queries with the page wizard.

## Trust markers

- Every value displays which system it came from.
- "live" badges mean the number was fetched from the source database when
  you looked, not from a copy.
- You act as `viewer` by default: reading everything, breaking nothing;
  the propose flow routes suggestions to the responsible steward.
