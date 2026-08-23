# Integrate workspace — developers

Every capability in the UI is an API first. Fetch
`GET /api/openapi.json` (or open Swagger at `/api/docs`) and everything below
is discoverable.

## Query surfaces

| Surface | Endpoint | Use when |
|---|---|---|
| SPARQL 1.1 | `POST /db/query` (cached passthrough) | meta-layer questions; graph-scoped or union |
| SPARQL update | `POST /db/update` | writes (role-gated, journaled) |
| Federation | `POST /api/federate/query` | live rows for a class; guarded SQL planned from the catalog |
| GraphQL | `POST /api/graphql` (SDL at `/api/graphql/sdl`) | shaped multi-entity reads; types generated from SHACL shapes |
| Search | `POST /es/studio/_search` | Elasticsearch/OpenSearch query DSL over the whole estate; `GET /api/search?q=` for the simple form |
| SQL console | `POST /api/sql/sources/:id/query` | read-only SQL against one source |
| Virtual layer | `/api/virtual/*` | instances/describe/search with live cross-DB link traversal |

## Connectors

`GET /api/sql/kinds` lists installed connector kinds. A connector is one
module in `server/connectors/` exporting `meta` (`{kind, label, targetKind}`)
and `create(id, target)` returning
`{tables, introspect, page, query, close}` — drop a file in, restart, done.
Shipped: sqlite, duckdb, postgres, mysql, snowflake (experimental).

## BI tools

Set `BI_PORT` and the server speaks the **PostgreSQL wire protocol** on that
port: Tableau, Power BI, Looker, psql, or any Postgres driver connects with
stock settings (no TLS, any user) and sees every business object as a table —
`SELECT ... FROM orders WHERE status = 'shipped' LIMIT 50` executes through
the federation layer against the owning database, live. Simple-query protocol
today; extended-protocol (parameterized) support is planned.

## Realtime & ops

- **WebSocket** `/ws` — `graph-changed` broadcasts (tag-aware) + presence.
- **Kafka journal** — `studio.changes` topic carries every mutation with full
  payloads; consume it for downstream sync.
- **Backups** — `/api/backup/*`: checkpoints, list, restore-to-point-in-time.
- **Cache** — `X-Cache: HIT-MEM | HIT-DISK | MISS` on read responses;
  `/api/cache/stats`.

## Identity

Send `X-Studio-User: <name>` — roles are enforced server-side on every write
path (direct, agent, proposals). Real authn (OIDC, API tokens) is on the
parity plan.
