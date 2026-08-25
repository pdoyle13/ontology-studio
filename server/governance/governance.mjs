// Data governance: users, roles, stewardship, permissions, and the proposal /
// review workflow. The model lives IN the graph (governance graph) like every
// other meta concern. Identity is the X-Studio-User header for now (no authn
// yet — the model is real, the login is honor-system; swap in SSO later).
//
// Roles:
//   admin   — everything
//   steward — direct writes WITHIN governed graphs; reviews proposals there
//   editor  — no direct writes; changes go through proposals
//   viewer  — read only (default for unknown users)
//
// Proposals: staged adds/dels stored as N-Triples literals ON the proposal
// node + metadata. draft → submitted → approved(merge)/rejected. Approval
// requires a steward of the target graph (or an admin). Every transition
// lands in the changelog. Staged triples are deliberately NOT live graph
// data — drafts must never surface in union-scope queries, search, or
// dashboards before merge.

import { Parser, Writer } from 'n3';

export const GOVERNANCE_GRAPH = 'https://studio.local/graphs/governance';
const STUDIO = 'https://studio.local/ns#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const PROPOSAL_NS = 'https://studio.local/graphs/proposals/';

const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

async function query(oxigraph, q) {
  const res = await fetch(`${oxigraph}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' },
    body: q,
  });
  if (!res.ok) throw new Error(`governance query ${res.status}`);
  return (await res.json()).results.bindings;
}

async function update(oxigraph, u) {
  const res = await fetch(`${oxigraph}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sparql-update' },
    body: u,
  });
  if (!res.ok) throw new Error(`governance update ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

// ---------------- users / roles / stewardship ----------------

let userCache = null; // { at, byName: Map }

export function invalidateGovernanceCache() {
  userCache = null;
}

export async function loadUsers(oxigraph) {
  if (userCache && Date.now() - userCache.at < 30_000) return userCache.byName;
  const rows = await query(
    oxigraph,
    `SELECT ?u ?name ?role ?g WHERE {
  GRAPH <${GOVERNANCE_GRAPH}> {
    ?u a <${STUDIO}User> ; <${RDFS}label> ?name ; <${STUDIO}role> ?role .
    OPTIONAL { ?u <${STUDIO}governs> ?g }
  }
}`
  );
  const byName = new Map();
  for (const b of rows) {
    const name = b.name.value;
    if (!byName.has(name)) byName.set(name, { iri: b.u.value, name, role: b.role.value, governs: [] });
    if (b.g) byName.get(name).governs.push(b.g.value);
  }
  userCache = { at: Date.now(), byName };
  return byName;
}

/** Resolve the acting user. Unknown names act as read-only viewers. */
export async function resolveUser(oxigraph, name) {
  const users = await loadUsers(oxigraph);
  return users.get(name) ?? { iri: null, name: name || 'anonymous', role: 'viewer', governs: [] };
}

/** May this user write DIRECTLY to these graphs (bypassing review)? */
export function canWriteDirect(user, graphs) {
  if (user.role === 'admin') return true;
  if (user.role === 'steward') {
    const targets = graphs.filter(Boolean);
    if (targets.length === 0) return false; // default-graph writes need admin
    return targets.every((g) => user.governs.includes(g));
  }
  return false;
}

export const canPropose = (user) => ['admin', 'steward', 'editor'].includes(user.role);

export function canReview(user, targetGraph) {
  if (user.role === 'admin') return true;
  return user.role === 'steward' && user.governs.includes(targetGraph);
}

export async function upsertUser(oxigraph, { name, role, governs = [] }) {
  if (!['admin', 'steward', 'editor', 'viewer'].includes(role)) throw new Error(`bad role: ${role}`);
  const iri = `${STUDIO}user/${name.replace(/[^\w-]/g, '_')}`;
  await update(
    oxigraph,
    `DELETE WHERE { GRAPH <${GOVERNANCE_GRAPH}> { <${iri}> ?p ?o } } ;
INSERT DATA { GRAPH <${GOVERNANCE_GRAPH}> {
  <${iri}> <${RDF}type> <${STUDIO}User> .
  <${iri}> <${RDFS}label> "${esc(name)}" .
  <${iri}> <${STUDIO}role> "${esc(role)}" .
  ${governs.map((g) => `<${iri}> <${STUDIO}governs> <${g}> .`).join('\n')}
} }`
  );
  invalidateGovernanceCache();
  return { iri, name, role, governs };
}

// ---------------- proposals / review workflow ----------------

const proposalIri = (id) => `${STUDIO}proposal/${id}`;
const STAGED_PRED = { adds: `${STUDIO}stagedAdd`, dels: `${STUDIO}stagedDel` };

/** Normalize a triples block to one N-Triples line per triple. */
function toNTLines(triplesText) {
  let t = triplesText.trim();
  if (t && !t.endsWith('.')) t += ' .'; // INSERT DATA blocks may omit the final dot
  const quads = new Parser().parse(t);
  const writer = new Writer({ format: 'N-Triples' });
  return writer
    .quadsToString(quads)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export async function createProposal(oxigraph, { author, title, targetGraph }) {
  if (!targetGraph) throw new Error('targetGraph required');
  const id = `p${Date.now().toString(36)}`;
  const iri = `${STUDIO}proposal/${id}`;
  await update(
    oxigraph,
    `INSERT DATA { GRAPH <${GOVERNANCE_GRAPH}> {
  <${iri}> <${RDF}type> <${STUDIO}Proposal> .
  <${iri}> <${STUDIO}proposalId> "${id}" .
  <${iri}> <${RDFS}label> "${esc(title || 'Untitled change')}" .
  <${iri}> <${STUDIO}author> "${esc(author)}" .
  <${iri}> <${STUDIO}targetGraph> <${targetGraph}> .
  <${iri}> <${STUDIO}status> "draft" .
  <${iri}> <${STUDIO}createdAt> "${new Date().toISOString()}"^^<${XSD}dateTime> .
} }`
  );
  return { id, iri, title, targetGraph, status: 'draft', author };
}

export async function listProposals(oxigraph) {
  const rows = await query(
    oxigraph,
    `SELECT ?p ?id ?title ?author ?target ?status ?created ?reviewer ?note WHERE {
  GRAPH <${GOVERNANCE_GRAPH}> {
    ?p a <${STUDIO}Proposal> ; <${STUDIO}proposalId> ?id ; <${RDFS}label> ?title ;
       <${STUDIO}author> ?author ; <${STUDIO}targetGraph> ?target ;
       <${STUDIO}status> ?status ; <${STUDIO}createdAt> ?created .
    OPTIONAL { ?p <${STUDIO}reviewer> ?reviewer }
    OPTIONAL { ?p <${STUDIO}decisionNote> ?note }
  }
} ORDER BY DESC(?created)`
  );
  return rows.map((b) => ({
    id: b.id.value,
    iri: b.p.value,
    title: b.title.value,
    author: b.author.value,
    targetGraph: b.target.value,
    status: b.status.value,
    createdAt: b.created.value,
    reviewer: b.reviewer?.value ?? null,
    note: b.note?.value ?? null,
  }));
}

export async function getProposal(oxigraph, id) {
  return (await listProposals(oxigraph)).find((p) => p.id === id) ?? null;
}

async function setStatus(oxigraph, iri, status, reviewer, note) {
  await update(
    oxigraph,
    `DELETE WHERE { GRAPH <${GOVERNANCE_GRAPH}> { <${iri}> <${STUDIO}status> ?s } } ;
INSERT DATA { GRAPH <${GOVERNANCE_GRAPH}> {
  <${iri}> <${STUDIO}status> "${esc(status)}" .
  ${reviewer ? `<${iri}> <${STUDIO}reviewer> "${esc(reviewer)}" .` : ''}
  ${note ? `<${iri}> <${STUDIO}decisionNote> "${esc(note)}" .` : ''}
} }`
  );
}

async function stagedLines(oxigraph, id, kind) {
  const rows = await query(
    oxigraph,
    `SELECT ?t WHERE { GRAPH <${GOVERNANCE_GRAPH}> { <${proposalIri(id)}> <${STAGED_PRED[kind]}> ?t } }`
  );
  return [...new Set(rows.map((b) => b.t.value))];
}

/** The reviewable diff: staged additions and deletions (N-Triples lines). */
export async function proposalDiff(oxigraph, id) {
  const [adds, dels] = await Promise.all([
    stagedLines(oxigraph, id, 'adds'),
    stagedLines(oxigraph, id, 'dels'),
  ]);
  return { adds, dels };
}

/**
 * Route a write into a proposal's staging area instead of the target graph.
 * Supports INSERT DATA / DELETE DATA bodies (the shapes the typed tools emit).
 * Staged triples live as literals on the proposal node — never as graph data.
 */
export async function stageIntoProposal(oxigraph, id, updateBody) {
  const m = /^\s*(INSERT|DELETE)\s+DATA\s*\{([\s\S]*)\}\s*;?\s*$/i.exec(updateBody);
  if (!m) throw new Error('proposal mode supports INSERT DATA / DELETE DATA only (no WHERE-updates)');
  const kind = m[1].toUpperCase() === 'INSERT' ? 'adds' : 'dels';
  // strip any GRAPH wrapper — the proposal's targetGraph carries the location
  const inner = m[2].replace(/GRAPH\s*<[^>]+>\s*\{([\s\S]*?)\}/gi, '$1');
  const lines = toNTLines(inner);
  if (lines.length) {
    await update(
      oxigraph,
      `INSERT DATA { GRAPH <${GOVERNANCE_GRAPH}> {
${lines.map((l) => `<${proposalIri(id)}> <${STAGED_PRED[kind]}> "${esc(l)}" .`).join('\n')}
} }`
    );
  }
  return { staged: kind };
}

export async function submitProposal(oxigraph, id) {
  const p = await getProposal(oxigraph, id);
  if (!p) throw new Error(`no such proposal: ${id}`);
  if (p.status !== 'draft') throw new Error(`cannot submit from status ${p.status}`);
  await setStatus(oxigraph, p.iri, 'submitted');
  return { ...p, status: 'submitted' };
}

export async function decideProposal(oxigraph, id, { approve, reviewer, note }) {
  const p = await getProposal(oxigraph, id);
  if (!p) throw new Error(`no such proposal: ${id}`);
  if (!['submitted', 'draft'].includes(p.status)) throw new Error(`cannot decide from status ${p.status}`);
  if (!approve) {
    await setStatus(oxigraph, p.iri, 'rejected', reviewer, note);
    return { ...p, status: 'rejected' };
  }
  const { adds, dels } = await proposalDiff(oxigraph, id);
  const target = p.targetGraph;
  if (dels.length) await update(oxigraph, `DELETE DATA { GRAPH <${target}> { ${dels.join('\n')} } }`);
  if (adds.length) await update(oxigraph, `INSERT DATA { GRAPH <${target}> { ${adds.join('\n')} } }`);
  await update(
    oxigraph,
    `DELETE WHERE { GRAPH <${GOVERNANCE_GRAPH}> {
  <${p.iri}> <${STAGED_PRED.adds}> ?a } } ;
DELETE WHERE { GRAPH <${GOVERNANCE_GRAPH}> {
  <${p.iri}> <${STAGED_PRED.dels}> ?d } }`
  );
  await setStatus(oxigraph, p.iri, 'merged', reviewer, note);
  return { ...p, status: 'merged', applied: { adds: adds.length, dels: dels.length } };
}

/** One-time seed: default users if the governance graph is empty. */
/**
 * One-time migration: earlier versions staged proposal edits in live named
 * graphs under PROPOSAL_NS, which leaked drafts into union-scope queries.
 * Convert any lingering staging graphs to on-proposal literals and drop them.
 */
export async function migrateStagingGraphs(oxigraph) {
  const rows = await query(
    oxigraph,
    `SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } FILTER(STRSTARTS(STR(?g), "${PROPOSAL_NS}")) }`
  );
  for (const b of rows) {
    const g = b.g.value;
    const m = new RegExp(`^${PROPOSAL_NS}(.+)/(adds|dels)$`).exec(g);
    if (m) {
      const [, id, kind] = m;
      const res = await fetch(`${oxigraph}/store?graph=${encodeURIComponent(g)}`, {
        headers: { Accept: 'application/n-triples' },
      });
      const lines = res.ok ? (await res.text()).split('\n').map((l) => l.trim()).filter(Boolean) : [];
      const p = await getProposal(oxigraph, id);
      if (p && ['draft', 'submitted'].includes(p.status) && lines.length) {
        await update(
          oxigraph,
          `INSERT DATA { GRAPH <${GOVERNANCE_GRAPH}> {
${lines.map((l) => `<${p.iri}> <${STAGED_PRED[kind]}> "${esc(l)}" .`).join('\n')}
} }`
        );
      }
    }
    await update(oxigraph, `DROP SILENT GRAPH <${g}>`);
  }
  return rows.length;
}

export async function seedGovernance(oxigraph, defaultGraphs = []) {
  const users = await loadUsers(oxigraph);
  if (users.size > 0) return false;
  await upsertUser(oxigraph, { name: 'pat', role: 'admin' });
  await upsertUser(oxigraph, { name: 'sam', role: 'steward', governs: defaultGraphs });
  await upsertUser(oxigraph, { name: 'quinn', role: 'editor' });
  return true;
}
