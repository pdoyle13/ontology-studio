# Security model

What Ontology Studio defends against and how. This is a summary of the
controls in the code, not a threat model or a pen-test report. It intentionally
contains no exploit payloads.

## Query construction

**SPARQL.** Every IRI that reaches a query or update string is serialized
through a single validator (`src/rdf/term.ts`, mirrored server-side in
`server/core/term.mjs`). `iri()` rejects any value containing the characters
the SPARQL IRIREF grammar forbids (`< > " { } | ^ \` `\` and control
characters), so an untrusted IRI cannot terminate the `<...>` early and inject
query syntax. `literal()` escapes lexical forms and validates language tags and
datatype IRIs the same way. Untrusted IRIs — from imported RDF, the modeling
agent's output, the relation picker, federated rows, and typed renames — all
pass through it. Write-command SPARQL is assembled by pure, unit-tested builders
(`src/rdf/commands.ts`) so the serialization is covered by tests, not just
inspection.

**SQL (federation).** Table and column identifiers come from the R2RML catalog,
which is writable by anyone who can author mappings. The federation builder
(`server/semantic/federation.mjs`) quotes every identifier as a standard SQL
delimited identifier (doubling embedded quotes) and rejects control characters,
so a hostile name cannot break out of the quotes. Values are parameterized or
escaped separately.

**SQL console.** The read-only SQL endpoint allowlists the opening keyword and
then rejects multi-statement bodies and any data-modifying keyword anywhere in
the (string/comment-stripped) body — closing the data-modifying-CTE and
statement-stacking bypasses. This is defense in depth; run the database
connection as a read-only user in production as well.

## Server-side requests

**SSRF.** User-supplied URLs (REST connector `baseUrl`, import-from-URL) are
checked by `assertPublicUrl()` (`server/core/net.mjs`) before any fetch: scheme
allowlist (http/https), plus DNS resolution with private, loopback, link-local,
and cloud-metadata ranges blocked. Operators who deliberately connect to an
internal API opt in per connector (`allowPrivateHost`). Note the check resolves
the address before the fetch but does not pin the socket; DNS-rebinding
pinning is a tracked follow-up.

**Path traversal.** The attach endpoint is admin-gated. When `DATA_ROOT` is set,
file-backed connectors (sqlite, duckdb) must resolve inside it — set this on any
shared/deployed instance so an API call cannot read arbitrary files. Left unset
(the local default), file paths are unconfined, which a single-user local setup
needs to attach databases from anywhere (e.g. a sibling repo).

## Identity and access

Authentication resolves in order: bearer API token → OIDC JWT (when configured)
→ `X-Studio-User` header. API tokens are stored only as SHA-256 hashes in the
server-state directory, never in the graph (graph snapshots are committed to
git). Set `AUTH_REQUIRED=1` for any shared deployment.

By default the server **binds to `127.0.0.1`** and trusts the `X-Studio-User`
header (an honor-system convenience for local development). It refuses to bind a
public interface unless `AUTH_REQUIRED=1`, and warns loudly in header-trust
mode. Authorization is governance-role based: direct writes need admin or
steward-of-every-targeted-graph; otherwise changes go through proposals.

**CSRF.** Credentials are header-based (never cookies), so a browser attaches no
ambient authority to a cross-site request. If cookie/session auth is ever added,
a CSRF token or strict SameSite + origin check becomes mandatory.

## Rendering and inputs

- **XSS.** User/instance-derived content is never injected as HTML. Search
  highlights render as React elements with plain-text segments (auto-escaped).
  The one remaining `dangerouslySetInnerHTML` sink renders only repo markdown
  bundled at build time — documented and invariant.
- **DoS.** The auto-tagger bounds its work (text length, label count, label
  length) so a large vocabulary or input cannot pin the event loop.
- **Prototype pollution.** User-supplied JSON (connector descriptors) is parsed
  with a reviver that strips `__proto__` / `constructor` / `prototype`.

## Deployment hardening checklist

- [ ] `AUTH_REQUIRED=1`, with API tokens and/or OIDC configured
- [ ] Database connections use read-only users for the SQL console
- [ ] `DATA_ROOT` set to a dedicated directory to confine file connectors
- [ ] REST connectors point only at intended hosts (`allowPrivateHost` off unless needed)
- [ ] Server reached only through a trusted reverse proxy / network boundary
- [ ] Secrets provided via environment, never committed

## Regression tests

The injection and input-hygiene defenses are covered by tests that encode the
exact vectors: `src/rdf/term.test.ts`, `src/rdf/commands.test.ts`,
`server/security/injection.test.mjs`, `server/semantic/federation.test.mjs`
(identifier quoting), `server/semantic/translate.test.mjs` (read-only guard),
`server/core/net.test.mjs` (SSRF), `server/core/paths.test.mjs` (traversal),
`server/core/json.test.mjs` (prototype pollution), and
`src/components/Omnibox.test.tsx` (highlight escaping).
