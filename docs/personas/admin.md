# Admin — operating the studio

## Run it

Dev: `npm run dev` (UI :5180 + server :7881; Oxigraph and Kafka via
`docker compose up -d oxigraph kafka` with the dev override in
`.devcontainer/compose.dev.yml`, or point `OXIGRAPH_URL` at any instance).

Prod: `docker compose up -d` — Kafka + Oxigraph + studio (UI+API on :8890).
Prebuilt images publish to GHCR on every push to main.

## Configuration (env)

| Var | Default | Purpose |
|---|---|---|
| `OXIGRAPH_URL` | `http://localhost:7880` | the triplestore |
| `STUDIO_SERVER_PORT` | `7881` | API/UI port |
| `KAFKA_BROKERS` | `localhost:19092` | change journal (graceful when down) |
| `GROK_API_KEY` / `XAI_API_KEY` | — | agent (primary) |
| `ANTHROPIC_API_KEY` | — | agent fallback |
| `AGENT_MODEL` | `grok-4` | model override |
| `SEARCH_URL` | — | external Elasticsearch/OpenSearch; blank = embedded index |
| `CACHE_TTL_MS` / `DISK_CACHE*` / `SQL_CACHE*` | sensible | cache tiers |
| `SERVE_UI` | unset | serve built UI from the server (set in the image) |

## Responsibilities

- **Sources** — attach/detach databases (UI SQL tab or `/api/sql/sources`);
  credentials are stripped before descriptors are stored or displayed.
- **Users & roles** — seed and manage via `/api/governance/users`; assign
  stewards with `studio:governs`.
- **Backups** — schedule checkpoints (`/api/backup/checkpoint`); each stores
  full graph dumps plus Kafka offsets for point-in-time restore.
- **Snapshots** — the `graph/` directory self-commits canonical N-Triples
  per named graph; push the repo somewhere durable.
- **Monitoring** — `/api/cache/stats`, `/es/_cat/indices`, healthcheck on
  `/es`; Datadog/Prometheus export is on the parity plan.
