# Quickstart

## Run the stack

```bash
npm install
# 1. Oxigraph (meta store)
oxigraph serve --location .oxigraph-data --bind 127.0.0.1:7880
# 2. sidecar (drivers, virtual layer, federation, agent, caching)
node --experimental-sqlite server/index.mjs
# 3. UI
npm run dev            # http://localhost:5180
```

Or under PM2 (`studio-oxigraph`, `studio-server`, `studio-ui`), or Docker:
`docker compose up -d --build` → http://localhost:8890.

The agent needs `GROK_API_KEY` (or `XAI_API_KEY` / `ANTHROPIC_API_KEY`) in
`.env` at the repo root.

## First five minutes

1. **Connect** — top bar → *Local Oxigraph (studio)*. Pick a named graph; the
   canvas opens on the schema overview (classes + how they connect).
2. **Attach a database** — sidebar → SQL tab → SQLite path or
   `postgres://user:pass@host/db` → *Attach*.
3. **Translate the schema** — one click. Classes + SHACL shapes + R2RML
   mappings appear in the graph. Instance data stays in the database.
4. **Browse live** — the class tree shows live rowcounts; expanding a class
   lists rows straight from the source (`live · db.table` badge in the
   inspector). Double-click canvas nodes to walk cross-database links.
5. **Connect databases** — ask the agent (✦ Agent tab):
   *"link shipments to orders — order_ref matches order_number"* → it declares
   the field-level link; traversal works immediately, nothing is copied.
6. **Discover business areas** — `POST /api/discover/business-areas` or ask
   the agent — every field gets a FIBO business concept.
7. **Ask cross-database questions** — *"which customers have shipped but
   undelivered orders, from live data?"* — the agent plans from the catalog and
   federates SQL across the owning databases.

## Useful endpoints

Interactive API docs: **http://localhost:7881/api/docs** (Swagger UI).
Spec: `GET /api/openapi.json`. Cache stats: `GET /api/cache/stats`.

## Tests

```bash
npm test               # vitest — client RDF layer, layout engine, server logic
```
