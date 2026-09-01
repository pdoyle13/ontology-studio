// R2RML mapping emission: the SQL→RDF mapping itself is RDF, written to a
// governed mappings graph: the mapping is a first-class model artifact.
// The mapping is inspectable, editable, and queryable in the studio like any

const RR = 'http://www.w3.org/ns/r2rml#';
const RDF_ = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const PROV = 'http://www.w3.org/ns/prov#';
const DCT = 'http://purl.org/dc/terms/';
export const STUDIO = 'https://studio.local/ns#';

export const MAPPINGS_GRAPH = 'https://studio.local/graphs/mappings';

const sane = (s) => String(s).replace(/[^\w-]/g, '_');
const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

/**
 * Emit R2RML TriplesMaps for a source schema as N-Triples.
 * classIriFn/propIriFn mirror the translation used for the data itself, so the
 * mapping graph is an exact, executable description of the materialization.
 */
export function emitR2rml({ sourceId, schema, ns, classIriFn, propIriFn, xsdFn, nowIso }) {
    const out = [];
    const t = (s, p, o) => out.push(`${s} ${p} ${o} .`);
    const mappingBase = `${STUDIO}mapping/${sane(sourceId)}/`;

    const src = `<${STUDIO}source/${sane(sourceId)}>`;
    t(src, `<${RDF_}type>`, `<${STUDIO}SqlSource>`);
    t(src, `<${RDFS}label>`, `"${esc(sourceId)}"`);
    t(src, `<${DCT}modified>`, `"${nowIso}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`);

    for (const table of schema) {
        const tm = `<${mappingBase}${sane(table.name)}>`;
        const fkByCol = new Map(table.fks.map((f) => [f.from, f]));
        const pkCols = table.columns.filter((c) => c.pk).map((c) => c.name);
        const template =
            pkCols.length > 0
                ? `${ns}${sane(table.name)}/{${pkCols.join('}_{')}}`
                : `${ns}${sane(table.name)}/{__rowid}`;

        t(tm, `<${RDF_}type>`, `<${RR}TriplesMap>`);
        t(tm, `<${PROV}wasDerivedFrom>`, src);
        const lt = `<${mappingBase}${sane(table.name)}-table>`;
        t(tm, `<${RR}logicalTable>`, lt);
        t(lt, `<${RR}tableName>`, `"${esc(table.name)}"`);
        const sm = `<${mappingBase}${sane(table.name)}-subject>`;
        t(tm, `<${RR}subjectMap>`, sm);
        t(sm, `<${RR}template>`, `"${esc(template)}"`);
        t(sm, `<${RR}class>`, `<${classIriFn(ns, table.name)}>`);

        table.columns.forEach((col) => {
            const pom = `<${mappingBase}${sane(table.name)}-pom-${sane(col.name)}>`;
            const om = `<${mappingBase}${sane(table.name)}-om-${sane(col.name)}>`;
            t(tm, `<${RR}predicateObjectMap>`, pom);
            t(pom, `<${RR}predicate>`, `<${propIriFn(ns, table.name, col.name)}>`);
            t(pom, `<${RR}objectMap>`, om);
            const fk = fkByCol.get(col.name);
            if (fk) {
                t(om, `<${RR}template>`, `"${esc(`${ns}${sane(fk.table)}/{${col.name}}`)}"`);
                t(om, `<${RR}termType>`, `<${RR}IRI>`);
            } else {
                t(om, `<${RR}column>`, `"${esc(col.name)}"`);
                const dt = xsdFn(col.type);
                if (dt) t(om, `<${RR}datatype>`, `<${dt}>`);
            }
        });
    }
    return out.join('\n');
}

/**
 * Provenance triples for a materialized data graph: where it came from, when,
 * and how much — queryable freshness metadata (written to the mappings graph).
 */
export function emitSyncProvenance({ sourceId, table, dataGraph, rows, triples, nowIso }) {
    const act = `<${STUDIO}sync/${sane(sourceId)}/${sane(table)}/${Date.parse(nowIso)}>`;
    const g = `<${dataGraph}>`;
    const out = [];
    const t = (s, p, o) => out.push(`${s} ${p} ${o} .`);
    t(act, `<${RDF_}type>`, `<${PROV}Activity>`);
    t(act, `<${STUDIO}materializedTable>`, `"${esc(table)}"`);
    t(act, `<${PROV}used>`, `<${STUDIO}source/${sane(sourceId)}>`);
    t(act, `<${PROV}generated>`, g);
    t(act, `<${PROV}endedAtTime>`, `"${nowIso}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`);
    t(act, `<${STUDIO}rowCount>`, `"${rows}"^^<http://www.w3.org/2001/XMLSchema#integer>`);
    t(act, `<${STUDIO}tripleCount>`, `"${triples}"^^<http://www.w3.org/2001/XMLSchema#integer>`);
    t(g, `<${PROV}wasDerivedFrom>`, `<${STUDIO}source/${sane(sourceId)}>`);
    t(g, `<${DCT}modified>`, `"${nowIso}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`);
    return out.join('\n');
}
