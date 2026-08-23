# Govern workspace — data stewards

You are accountable for what the model says. The studio makes every change
attributable, reviewable, and reversible.

## Daily surface

- **Reviews tab** — the proposal queue. Each proposal shows a +/− diff of
  staged additions and deletions. You can approve (merge) or reject with a
  note; self-approval is blocked; only stewards of the target graph (declared
  via `studio:governs`) or admins can decide.
- **Changelog** — every write, by whom, which graphs, when, with detail —
  from the in-graph audit log; the Kafka journal keeps the full replayable
  payloads.
- **Checkpoints** — point-in-time snapshots (graph dumps + journal offsets).
  Restore rebuilds the store to any checkpoint and replays the journal up to
  a chosen moment.
- **Issues tab** — run SHACL validation across the scope; violations link to
  the offending resource and the responsible shape.
- **Acting-as picker** — the identity chip in the connection bar; all gates
  are enforced server-side from `X-Studio-User`.

## The workflow

1. Editors work normally; on governed graphs their writes stage into a
   proposal automatically (the agent has a "propose" mode too).
2. Staged changes are invisible to everyone else until merged.
3. You review the diff, decide, and the decision is audited.
4. Anything merged is still undoable, journaled, snapshotted, and
   checkpoint-restorable.

## Stewardship model

- `studio:governs` links a steward to the graphs they own.
- Roles: `viewer` (read), `editor` (propose/write ungoverned), `steward`
  (review + direct write on owned graphs), `admin` (everything).
- User admin: `/api/governance/users` (UI panel planned — see parity plan).
