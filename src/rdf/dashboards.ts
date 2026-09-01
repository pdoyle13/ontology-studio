// Dashboards: pages of widgets, stored in the graph like every other asset.
// A widget binds a saved query (SPARQL or SQL) to a component (table, bar,
// line, pie, kpi) with optional x/y field picks. Execution is always live —
// SPARQL through the endpoint, SQL through the owning source.

import type { Endpoint } from './sparqlClient';
import { select, update } from './sparqlClient';
import { serializeTerm } from './mutations';
import { useHistory } from '../state/history';
import { slug } from './skosExt';
import { listSavedQueries, applyParams, type SavedQuery } from './savedQueries';

const STUDIO = 'https://studio.local/ns#';
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
export const DASH_GRAPH = 'https://studio.local/graphs/dashboards';

export type WidgetComponent = 'table' | 'bar' | 'line' | 'pie' | 'kpi';

export interface WidgetDef {
    iri: string;
    label: string;
    component: WidgetComponent;
    queryIri: string;
    xField: string | null;
    yField: string | null;
    position: number;
}

export interface DashboardDef {
    iri: string;
    label: string;
    widgets: WidgetDef[];
}

export async function listDashboards(ep: Endpoint): Promise<{ iri: string; label: string; widgetCount: number }[]> {
    const q = `
SELECT ?d ?label (COUNT(?w) AS ?n) WHERE {
  GRAPH <${DASH_GRAPH}> {
    ?d a <${STUDIO}Dashboard> ; <${RDFS_LABEL}> ?label .
    OPTIONAL { ?d <${STUDIO}widget> ?w }
  }
}
GROUP BY ?d ?label ORDER BY ?label`;
    try {
        const r = await select(ep, q);
        return r.bindings
            .filter((b) => b.d)
            .map((b) => ({ iri: b.d.value, label: b.label.value, widgetCount: Number(b.n?.value ?? 0) }));
    } catch {
        return [];
    }
}

export async function fetchDashboard(ep: Endpoint, iri: string): Promise<DashboardDef | null> {
    const q = `
SELECT ?label ?w ?wl ?comp ?query ?x ?y ?pos WHERE {
  GRAPH <${DASH_GRAPH}> {
    <${iri}> <${RDFS_LABEL}> ?label .
    OPTIONAL {
      <${iri}> <${STUDIO}widget> ?w .
      ?w <${RDFS_LABEL}> ?wl ; <${STUDIO}component> ?comp ; <${STUDIO}query> ?query .
      OPTIONAL { ?w <${STUDIO}xField> ?x }
      OPTIONAL { ?w <${STUDIO}yField> ?y }
      OPTIONAL { ?w <${STUDIO}position> ?pos }
    }
  }
}`;
    const r = await select(ep, q);
    if (r.bindings.length === 0) return null;
    const widgets = r.bindings
        .filter((b) => b.w)
        .map((b) => ({
            iri: b.w.value,
            label: b.wl?.value ?? 'widget',
            component: (b.comp?.value ?? 'table') as WidgetComponent,
            queryIri: b.query.value,
            xField: b.x?.value ?? null,
            yField: b.y?.value ?? null,
            position: b.pos ? Number(b.pos.value) : 0,
        }))
        .sort((a, b) => a.position - b.position);
    return { iri, label: r.bindings[0].label.value, widgets };
}

export async function cmdCreateDashboard(ep: Endpoint, label: string): Promise<string> {
    const iri = `https://studio.local/dashboard/${slug(label)}`;
    const block = [
        `<${iri}> a <${STUDIO}Dashboard> .`,
        `<${iri}> <${RDFS_LABEL}> ${serializeTerm({ type: 'literal', value: label })} .`,
    ].join('\n');
    await useHistory.getState().exec({
        label: 'create dashboard',
        redo: () => update(ep, `INSERT DATA { GRAPH <${DASH_GRAPH}> { ${block} } }`),
        undo: () => update(ep, `DELETE DATA { GRAPH <${DASH_GRAPH}> { ${block} } }`),
    });
    return iri;
}

export async function cmdAddWidget(
    ep: Endpoint,
    dashboard: string,
    spec: {
        label: string;
        component: WidgetComponent;
        queryIri: string;
        xField?: string | null;
        yField?: string | null;
        position: number;
    },
): Promise<void> {
    const iri = `${dashboard}/widget/${slug(spec.label)}-${spec.position}`;
    const t = [
        `<${dashboard}> <${STUDIO}widget> <${iri}> .`,
        `<${iri}> a <${STUDIO}Widget> .`,
        `<${iri}> <${RDFS_LABEL}> ${serializeTerm({ type: 'literal', value: spec.label })} .`,
        `<${iri}> <${STUDIO}component> ${serializeTerm({ type: 'literal', value: spec.component })} .`,
        `<${iri}> <${STUDIO}query> <${spec.queryIri}> .`,
        `<${iri}> <${STUDIO}position> "${spec.position}"^^<http://www.w3.org/2001/XMLSchema#integer> .`,
    ];
    if (spec.xField) t.push(`<${iri}> <${STUDIO}xField> ${serializeTerm({ type: 'literal', value: spec.xField })} .`);
    if (spec.yField) t.push(`<${iri}> <${STUDIO}yField> ${serializeTerm({ type: 'literal', value: spec.yField })} .`);
    const block = t.join('\n');
    await useHistory.getState().exec({
        label: 'add widget',
        redo: () => update(ep, `INSERT DATA { GRAPH <${DASH_GRAPH}> { ${block} } }`),
        undo: () => update(ep, `DELETE DATA { GRAPH <${DASH_GRAPH}> { ${block} } }`),
    });
}

export async function cmdRemoveWidget(ep: Endpoint, dashboard: string, widget: string): Promise<void> {
    const snapQ = `SELECT ?p ?o WHERE { GRAPH <${DASH_GRAPH}> { <${widget}> ?p ?o } }`;
    const r = await select(ep, snapQ);
    const snapshot = r.bindings
        .map(
            (b) =>
                `<${widget}> <${b.p.value}> ${b.o.type === 'uri' ? `<${b.o.value}>` : serializeTerm({ type: 'literal', value: b.o.value, datatype: (b.o as { datatype?: string }).datatype })} .`,
        )
        .concat([`<${dashboard}> <${STUDIO}widget> <${widget}> .`])
        .join('\n');
    await useHistory.getState().exec({
        label: 'remove widget',
        redo: () =>
            update(
                ep,
                `DELETE WHERE { GRAPH <${DASH_GRAPH}> { <${widget}> ?p ?o } } ; DELETE WHERE { GRAPH <${DASH_GRAPH}> { <${dashboard}> <${STUDIO}widget> <${widget}> } }`,
            ),
        undo: () => update(ep, `INSERT DATA { GRAPH <${DASH_GRAPH}> { ${snapshot} } }`),
    });
}

/** Run a widget's saved query → uniform rows. */
export async function runWidgetQuery(
    ep: Endpoint,
    queryIri: string,
    saved?: SavedQuery[],
): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
    const queries = saved ?? (await listSavedQueries(ep));
    const q = queries.find((x) => x.iri === queryIri);
    if (!q) throw new Error('saved query not found');
    if (q.mode === 'sql') {
        if (!q.sourceId) throw new Error('SQL query has no source');
        const res = await fetch(`/api/sql/sources/${q.sourceId}/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: applyParams(q.text, q.params) }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `${res.status}`);
        return { columns: json.columns, rows: json.rows };
    }
    const r = await select(ep, applyParams(q.text, q.params), { union: true });
    return {
        columns: r.vars,
        rows: r.bindings.map((b) => Object.fromEntries(r.vars.map((v) => [v, b[v]?.value ?? null]))),
    };
}
