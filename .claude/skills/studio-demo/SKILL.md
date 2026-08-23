---
name: studio-demo
description: Rebuild the cross-industry demo estate from scratch — 10 databases, meta-only graph, field-level links, FIBO discovery, outputs. Use when the demo is broken, when resetting, or when adding new demo organizations.
---

# Demo estate rebuild

The demo: 10 databases across industries, ONE meta-only graph, everything else live.

| source | engine | tables |
|---|---|---|
| crm_db / sales_db / wms_db / shipping_db | Postgres (studio-pg) | customers · orders · warehouses · shipments |
| bank_core_db / insurance_db / hr_db | Postgres | accounts+bank_transactions · policies+claims · employees+payroll |
| delivery_db / retail_pos_db / support_db | SQLite (`seed/*.db`) | delivery_events · pos_sales · tickets |

Deterministic keys tie them: order id `i` → `ORD-(1000+i)` → shipment `TRK-(77000+i)`
(orders with `i%20<13` have shipments; `<8` are delivered). Customer `N` ↔ `userN@example.com`.

## Full rebuild sequence

1. **Databases** — if `studio-pg` data is gone, re-run the seeding SQL (see git
   history: "Scale commerce databases" / "Scale banking, insurance, HR"); sqlite
   seeds are committed scripts in history too.
2. **Meta layer** (the important part — NEVER materialize instances):
   ```
   POST /db/update            DROP GRAPH <https://studio.local/graphs/lineage>
   POST /api/sql/sources/{id}/translate {"graph": "<lineage>"}   # for each source
   ```
3. **Field-level links** (meta declarations only; agent tool `declare_link`, or direct INSERT):
   - placedBy: orders.customer_id = customers.id
   - forOrder: shipments.order_ref = orders.order_number
   - shippedFrom: shipments.warehouse_id = warehouses.id
   - forShipment: delivery_events.tracking_ref = shipments.tracking_no
   - ticketsForCustomer: tickets.customer_email = customers.email
4. **FIBO vocabulary**: load `seed/fibo-core.ttl` into `<https://studio.local/graphs/fibo>`
   via `/db/store?graph=...` (drop first for a clean reload).
5. **Discovery**: `POST /api/discover/business-areas` (idempotent; rebuilds the alignment graph).
6. **Outputs** (flow view right column): `studio:Output` instances with
   `studio:consumes` edges — Order Lineage, Customer 360, Financial Exposure.

## Acceptance

- `/api/virtual/classes` → 13 classes, live rowcounts (orders 504, delivery_events 807)
- `/api/virtual/describe` on `…sales_db#orders/1` → label ORD-1001, `placedBy → Ada Lovelace`, incoming `forOrder ← TRK-77001`
- Instance-triples-in-graph check must be **0**; meta triples ≈ 800
- Agent question "which customers have shipped but undelivered orders?" federates and answers (Alan Turing / ORD-1004 pattern)
