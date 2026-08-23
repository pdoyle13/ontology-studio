# Governance, review, audit, and recovery

The governance model lives IN the graph (governance graph) like every other
meta concern. Identity is the `X-Studio-User` header (dev default `pat`; the
model is enforced, the login is honor-system until SSO lands). Pick who you're
acting as in the top bar.

## Roles & stewardship

| role | direct writes | propose | review/approve |
|---|---|---|---|
| **admin** | everywhere | ✓ | anything |
| **steward** | only graphs they govern (`studio:governs`) | ✓ | proposals targeting their graphs |
| **editor** | never — changes go through proposals | ✓ | — |
| **viewer** (default for unknown users) | never | ✗ | — |

Manage users: `GET/POST /api/governance/users` (admin). Seeded: `pat` (admin),
`sam` (steward of the lineage graph), `quinn` (editor).

## Review workflow (proposals)

`draft → submitted → merged | rejected`. A proposal stages additions and
deletions in its own graphs; the target graph is untouched until a steward of
that graph (or an admin) approves — then the diff is applied atomically.

- Create: `POST /api/proposals {title, targetGraph}`
- Stage: any `INSERT DATA`/`DELETE DATA` write with header `X-Studio-Proposal: <id>`;
  or toggle **propose** in the agent panel — its tool writes stage instead of applying
- Review: sidebar **Reviews** tab — staged diff (+/−), submit / approve / reject,
  gated by your acting role. Self-approval by editors is impossible by construction.

## Audit trail — two layers

1. **Changelog graph**: every write records actor, operation, target graphs,
   detail, timestamp (`GET /api/governance/changelog`).
2. **Kafka journal** (`studio.changes` topic): every write also publishes a
   *replayable* event carrying the full mutation payload. Broker: `KAFKA_BROKERS`
   (default `localhost:19092`, dev container `studio-kafka`). Kafka being down
   never blocks writes — the graph audit remains authoritative.

## Versioning & recovery — three layers

1. **Meta-layer-as-code**: every write debounces into canonical sorted
   N-Triples snapshots under `graph/`, auto-committed — ontology diffs,
   history, and rollback through plain git.
2. **Checkpoints**: `POST /api/backup/checkpoint` dumps every named graph +
   records the journal offsets (`backups/<id>/`, gitignored).
3. **Point-in-time restore**: `POST /api/backup/restore {checkpoint, until?, confirm:true}`
   (admin) — loads the checkpoint, then replays journal events up to `until`.
   Classic checkpoint + WAL, with Kafka as the WAL. If Kafka is unavailable the
   restore degrades to snapshot-only and says so (`replayError`).

## Engineering process

- `.githooks/pre-commit` runs the test suite (enable once per clone:
  `git config core.hooksPath .githooks`); graph-snapshot auto-commits skip it.
- `.github/workflows/ci.yml` builds + tests on push/PR — takes effect as soon
  as the repo gets a remote (`git remote add origin … && git push -u origin main`).
