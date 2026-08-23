---
name: studio-stack
description: Start, stop, restart, and health-check the Ontology Studio stack (Oxigraph, sidecar server, UI, demo Postgres). Use for any "restart the studio", "is the stack up", or port/process confusion.
---

# Studio stack operations

## Processes (PM2)

| name | what | port |
|---|---|---|
| `studio-oxigraph` | Oxigraph meta store (`oxigraph.exe serve --location .oxigraph-data`) | 7880 |
| `studio-server` | sidecar: drivers, virtual layer, federation, agent, caching, WS (`node --experimental-sqlite server/index.mjs`) | 7881 |
| `studio-ui` | Vite dev server | 5180 |
| docker `studio-pg` | demo Postgres (user `postgres` / pw `studio`) | 15432 |

```bash
pm2 restart studio-server          # ALWAYS after editing server/*.mjs — no hot reload
pm2 restart studio-ui              # only needed after vite.config.ts changes
pm2 logs studio-server --lines 30  # errors land here
docker start studio-pg             # if the demo databases are down
```

## Health checks

```bash
curl -s http://localhost:7881/api/health         # {ok, sources: N, agent: true}
curl -s http://localhost:7881/api/cache/stats    # memory/disk/sql tiers
curl -s http://localhost:7881/api/virtual/classes | head -c 300
```

`agent:false` → `GROK_API_KEY` missing from repo-root `.env` (gitignored) or the
server started before it existed → restart.
`sources` < 10 → `server/sources.json` lost or `studio-pg` container down.

## Gotchas

- `--experimental-sqlite` must be a **node argument**, not NODE_OPTIONS (disallowed there).
- Port **7878 belongs to the kalshi stack's Oxigraph** — never bind the studio there.
- Docker compose maps the containerized studio to **8890**; the PM2 dev stack is the primary.
- The UI reaches the server via Vite proxies `/db`, `/api`, `/ws` (ws upgrade) → 7881.
- Every server code change: restart `studio-server`, then re-verify `/api/health`.
