// Virtual instance layer: NO instance triples live in the store. The graph
// holds the meta layer only (classes, shapes, R2RML mappings, field-level link
// declarations with join keys). Instance browsing, description, and traversal
// resolve HERE — live SQL against the owning databases, planned from the graph.

import { buildSelect, mintSubject } from './federation.mjs';
import { sparql } from '../core/meta.mjs';

const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const SH = 'http://www.w3.org/ns/shacl#';
const DASH = 'http://datashapes.org/dash#';
const STUDIO = 'https://studio.local/ns#';

/** Field-level link declarations: [{property, from, to, sourceKeyProperty, targetKeyProperty}]. */
export async function readLinkSpecs(oxigraph) {
    const rows = await sparql(
        oxigraph,
        `SELECT ?p ?dom ?rng ?sk ?tk WHERE {
  ?p <${RDFS}domain> ?dom ; <${RDFS}range> ?rng ;
     <${STUDIO}sourceKeyProperty> ?sk ; <${STUDIO}targetKeyProperty> ?tk .
}`,
    );
    return rows.map((b) => ({
        property: b.p.value,
        from: b.dom.value,
        to: b.rng.value,
        sourceKeyProperty: b.sk.value,
        targetKeyProperty: b.tk.value,
    }));
}

/** Properties designated as labels via dash:LabelRole. */
export async function readLabelProps(oxigraph) {
    const rows = await sparql(
        oxigraph,
        `SELECT ?path WHERE { ?ps <${DASH}propertyRole> <${DASH}LabelRole> ; <${SH}path> ?path }`,
    );
    return new Set(rows.map((b) => b.path.value));
}

const colFor = (entry, propertyIri) => entry.columns.find((c) => c.property === propertyIri)?.column ?? null;
const labelColumn = (entry, labelProps) => entry.columns.find((c) => labelProps.has(c.property))?.column ?? null;

/** Parse a virtual IRI against catalog subject templates → {entry, filters} or null. */
export function matchSubject(catalog, iri) {
    for (const entry of catalog) {
        const cols = [];
        const pattern = entry.subjectTemplate
            .replace(/[.*+?^${}()|[\]\\]/g, (m) => `\\${m}`)
            .replace(/\\\{([^}]+)\\\}/g, (_, col) => {
                cols.push(col);
                return '([^/]+?)';
            });
        const m = new RegExp(`^${pattern}$`).exec(iri);
        if (!m) continue;
        const filters = cols.map((column, i) => ({ column, op: '=', value: decodeURIComponent(m[i + 1]) }));
        if (filters.length === 0) continue;
        return { entry, filters };
    }
    return null;
}

/** List instances of a virtual class — live SQL, label from the dash:LabelRole column. */
export async function virtualInstances({ oxigraph, catalog, drivers, classIri, search = '', limit = 200 }) {
    const entry = catalog.find((c) => c.classIri === classIri);
    if (!entry) return null;
    const driver = drivers.get(entry.sourceId);
    if (!driver) throw new Error(`source ${entry.sourceId} not attached`);
    const labelProps = await readLabelProps(oxigraph);
    const labelCol = labelColumn(entry, labelProps);
    const filters = search && labelCol ? [{ column: labelCol, op: 'LIKE', value: `%${search}%` }] : [];
    const sql = buildSelect(entry, { filters, limit });
    const rows = await driver.query(sql);
    return rows.map((r) => ({
        iri: mintSubject(entry, r),
        label: labelCol && r[labelCol] != null ? String(r[labelCol]) : null,
    }));
}

/** Search live rows across every source: label-column LIKE per class, fanned in parallel. */
export async function virtualSearch({ oxigraph, catalog, drivers, text, perClass = 3, total = 30, labelProps = null }) {
    labelProps = labelProps ?? (await readLabelProps(oxigraph));
    const jobs = catalog.map(async (entry) => {
        const driver = drivers.get(entry.sourceId);
        const labelCol = labelColumn(entry, labelProps);
        if (!driver || !labelCol) return [];
        try {
            const sql = buildSelect(entry, {
                filters: [{ column: labelCol, op: 'ILIKE', value: `%${text}%` }],
                limit: perClass,
            });
            const rows = await driver.query(sql);
            return rows.map((r) => ({
                iri: mintSubject(entry, r),
                label: r[labelCol] != null ? String(r[labelCol]) : null,
                classIri: entry.classIri,
                sourceId: entry.sourceId,
            }));
        } catch {
            return [];
        }
    });
    return (await Promise.all(jobs)).flat().slice(0, total);
}

/**
 * Describe a virtual resource — one live row plus field-level link traversal:
 * outgoing column values, in-database FK objects, and cross-database links
 * resolved at query time from the declared join keys. Nothing is materialized.
 */
export async function virtualDescribe({ oxigraph, catalog, drivers, iri, linkLimit = 25 }) {
    const match = matchSubject(catalog, iri);
    if (!match) return null;
    const { entry, filters } = match;
    const driver = drivers.get(entry.sourceId);
    if (!driver) throw new Error(`source ${entry.sourceId} not attached`);

    const rows = await driver.query(buildSelect(entry, { filters, limit: 1 }));
    if (rows.length === 0) return { iri, missing: true };
    const row = rows[0];

    const [labelProps, linkSpecs] = await Promise.all([readLabelProps(oxigraph), readLinkSpecs(oxigraph)]);
    const labelCol = labelColumn(entry, labelProps);

    const outgoing = [];
    for (const col of entry.columns) {
        const v = row[col.column];
        if (v === null || v === undefined) continue;
        outgoing.push({
            predicate: col.property,
            object: { type: 'literal', value: String(v), datatype: col.datatype ?? undefined },
        });
    }
    for (const ref of entry.refs) {
        const v = ref.column ? row[ref.column] : null;
        if (v === null || v === undefined) continue;
        outgoing.push({
            predicate: ref.property,
            object: { type: 'uri', value: ref.template.replace(/\{[^}]+\}/, encodeURIComponent(String(v))) },
        });
    }

    const incoming = [];
    const byClass = (c) => catalog.find((e) => e.classIri === c);

    for (const spec of linkSpecs) {
        if (spec.from === entry.classIri) {
            // this row → targets: join on sourceKey value against target's key column
            const srcCol = colFor(entry, spec.sourceKeyProperty);
            const target = byClass(spec.to);
            const tgtCol = target ? colFor(target, spec.targetKeyProperty) : null;
            const v = srcCol ? row[srcCol] : null;
            if (!target || !tgtCol || v === null || v === undefined) continue;
            const tDriver = drivers.get(target.sourceId);
            if (!tDriver) continue;
            const tLabelCol = labelColumn(target, labelProps);
            const tRows = await tDriver.query(
                buildSelect(target, { filters: [{ column: tgtCol, op: '=', value: v }], limit: linkLimit }),
            );
            for (const tr of tRows) {
                outgoing.push({
                    predicate: spec.property,
                    object: {
                        type: 'uri',
                        value: mintSubject(target, tr),
                        label: tLabelCol && tr[tLabelCol] != null ? String(tr[tLabelCol]) : undefined,
                    },
                });
            }
        }
        if (spec.to === entry.classIri) {
            // sources → this row: reverse join
            const source = byClass(spec.from);
            const srcCol = source ? colFor(source, spec.sourceKeyProperty) : null;
            const myCol = colFor(entry, spec.targetKeyProperty);
            const v = myCol ? row[myCol] : null;
            if (!source || !srcCol || v === null || v === undefined) continue;
            const sDriver = drivers.get(source.sourceId);
            if (!sDriver) continue;
            const sLabelCol = labelColumn(source, labelProps);
            const sRows = await sDriver.query(
                buildSelect(source, { filters: [{ column: srcCol, op: '=', value: v }], limit: linkLimit }),
            );
            for (const sr of sRows) {
                incoming.push({
                    subject: mintSubject(source, sr),
                    subjectLabel: sLabelCol && sr[sLabelCol] != null ? String(sr[sLabelCol]) : null,
                    predicate: spec.property,
                });
            }
        }
    }

    return {
        iri,
        label: labelCol && row[labelCol] != null ? String(row[labelCol]) : null,
        types: [entry.classIri],
        outgoing,
        incoming,
        incomingTotal: incoming.length,
        virtual: { sourceId: entry.sourceId, table: entry.table },
    };
}
