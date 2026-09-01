// Lifecycle workflows: configurable state machines per asset type, declared
// in the extensions graph — states plus transitions with the role each one
// requires. Assets carry their state as one studio:state literal; every
// transition is role-checked, journaled, and broadcast.

import { sparql, metaStore } from '../core/meta.mjs';

const STUDIO = 'https://studio.local/ns#';
const EXT_GRAPH = 'https://studio.local/graphs/extensions';
export const STATE_GRAPH = 'https://studio.local/graphs/lifecycle';

/** The default workflow when an asset type declares none. */
export const DEFAULT_WORKFLOW = {
    states: ['draft', 'in-review', 'approved', 'deprecated'],
    transitions: [
        { from: 'draft', to: 'in-review', label: 'Submit for review', role: 'editor' },
        { from: 'in-review', to: 'approved', label: 'Approve', role: 'steward' },
        { from: 'in-review', to: 'draft', label: 'Send back', role: 'steward' },
        { from: 'approved', to: 'deprecated', label: 'Deprecate', role: 'steward' },
        { from: 'deprecated', to: 'draft', label: 'Revive', role: 'steward' },
    ],
    initial: 'draft',
};

const ROLE_RANK = { viewer: 0, editor: 1, steward: 2, admin: 3 };

/** Pure: can this role take this transition? Admin can do anything. */
export function roleAllows(userRole, requiredRole) {
    return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[requiredRole] ?? 99);
}

/** Pure: transitions available from a state for a role. */
export function availableTransitions(workflow, state, role) {
    const cur = state ?? workflow.initial;
    return workflow.transitions.filter((t) => t.from === cur && roleAllows(role, t.role));
}

/**
 * Pure: validate one requested transition. Returns null when allowed, else
 * { status, error } — 400 for a transition the workflow doesn't define
 * (client error), 403 only when the transition exists but the role lacks it.
 */
export function validateTransition(workflow, state, to, role) {
    const cur = state ?? workflow.initial;
    const t = workflow.transitions.find((x) => x.from === cur && x.to === to);
    if (!t) return { status: 400, error: `no transition ${cur} → ${to}` };
    if (!roleAllows(role, t.role))
        return { status: 403, error: `transition "${t.label}" needs ${t.role} (you are ${role})` };
    return null;
}

/** Workflow for an asset type IRI (custom in the graph, else the default). */
export async function readWorkflow(oxigraph, assetTypeIri) {
    if (assetTypeIri) {
        try {
            const rows = await sparql(
                oxigraph,
                `SELECT ?wf WHERE { GRAPH <${EXT_GRAPH}> { <${assetTypeIri}> <${STUDIO}workflow> ?wf } } LIMIT 1`,
            );
            const raw = rows[0]?.wf?.value;
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed.states) && Array.isArray(parsed.transitions)) return parsed;
            }
        } catch {
            /* fall through to default */
        }
    }
    return DEFAULT_WORKFLOW;
}

export async function getState(oxigraph, iri) {
    const rows = await sparql(
        oxigraph,
        `SELECT ?s WHERE { GRAPH <${STATE_GRAPH}> { <${iri}> <${STUDIO}state> ?s } } LIMIT 1`,
    );
    return rows[0]?.s?.value ?? null;
}

export async function setState(oxigraph, iri, to) {
    const esc = to.replace(/["\\]/g, '');
    await metaStore(oxigraph).updateRaw(
        `DELETE WHERE { GRAPH <${STATE_GRAPH}> { <${iri}> <${STUDIO}state> ?s } } ;
     INSERT DATA { GRAPH <${STATE_GRAPH}> { <${iri}> <${STUDIO}state> "${esc}" } }`,
    );
}
