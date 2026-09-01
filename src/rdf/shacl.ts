// SHACL layer: read NodeShapes/property shapes for a set of classes.
// Shapes drive the inspector form (order, names, datatypes, cardinality) —
// the DASH pattern: the shape IS the model contract.

import type { Endpoint } from './sparqlClient';
import { SH, DASH } from './vocab';
import { select } from './sparqlClient';
import { scoped } from './queries';

export interface PropertyShapeInfo {
    shapeIri: string; // the NodeShape
    path: string;
    name: string | null;
    description: string | null;
    datatype: string | null;
    classIri: string | null; // sh:class — object property whose values are instances of this
    nodeKind: string | null;
    minCount: number | null;
    maxCount: number | null;
    order: number;
    minInclusive: string | null;
    maxInclusive: string | null;
    pattern: string | null;
    inValues: { value: string; isIri: boolean }[] | null; // sh:in enumeration
    codelist: string | null; // studio:codelist — options resolve live from this scheme's active concepts
    singleLine: boolean | null; // dash:singleLine — false renders a textarea
    maxLength: number | null;
}

export interface NodeShapeInfo {
    iri: string;
    targetClass: string;
    properties: PropertyShapeInfo[];
}

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

/** Fetch sh:in enumerations for the property shapes of the given node shapes.
 *  Keyed by `${shapeIri}|${path}`. List order preserved via rdf:rest depth. */
async function fetchInLists(
    ep: Endpoint,
    graph: string | null,
    shapeIris: string[],
): Promise<Map<string, { value: string; isIri: boolean }[]>> {
    const result = new Map<string, { value: string; isIri: boolean }[]>();
    if (shapeIris.length === 0) return result;
    const values = shapeIris.map((s) => `<${s}>`).join(' ');
    const q = `
SELECT ?shape ?path ?cell ?inVal (COUNT(?mid) AS ?depth) WHERE {
  VALUES ?shape { ${values} }
  ${scoped(
      `?shape <${SH.property}> ?ps .
     ?ps <${SH.path}> ?path .
     ?ps <${SH.in}> ?list .
     ?list <${RDF}rest>* ?cell .
     ?cell <${RDF}first> ?inVal .
     ?list <${RDF}rest>* ?mid .
     ?mid <${RDF}rest>* ?cell .`,
      graph,
  )}
}
GROUP BY ?shape ?path ?cell ?inVal ORDER BY ?shape ?path ?depth`;
    try {
        const r = await select(ep, q);
        for (const b of r.bindings) {
            if (!b.shape || !b.path || !b.inVal) continue;
            const key = `${b.shape.value}|${b.path.value}`;
            if (!result.has(key)) result.set(key, []);
            result.get(key)!.push({ value: b.inVal.value, isIri: b.inVal.type === 'uri' });
        }
    } catch {
        /* endpoints without property-path support just get no enums */
    }
    return result;
}

/** Fetch node shapes targeting any of the given classes, with their property shapes. */
export async function fetchShapesForClasses(
    ep: Endpoint,
    graph: string | null,
    classIris: string[],
): Promise<NodeShapeInfo[]> {
    if (classIris.length === 0) return [];
    const values = classIris.map((c) => `<${c}>`).join(' ');
    const q = `
SELECT ?shape ?target ?ps ?path ?name ?desc ?datatype ?cls ?nodeKind ?minCount ?maxCount ?order ?minInc ?maxInc ?pattern ?singleLine ?maxLen ?codelist WHERE {
  VALUES ?target { ${values} }
  ${scoped(
      `?shape <${SH.targetClass}> ?target .
     ?shape <${SH.property}> ?ps .
     ?ps <${SH.path}> ?path .
     OPTIONAL { ?ps <${SH.name}> ?name }
     OPTIONAL { ?ps <${SH.description}> ?desc }
     OPTIONAL { ?ps <${SH.datatype}> ?datatype }
     OPTIONAL { ?ps <${SH.class}> ?cls }
     OPTIONAL { ?ps <${SH.nodeKind}> ?nodeKind }
     OPTIONAL { ?ps <${SH.minCount}> ?minCount }
     OPTIONAL { ?ps <${SH.maxCount}> ?maxCount }
     OPTIONAL { ?ps <${SH.order}> ?order }
     OPTIONAL { ?ps <${SH.minInclusive}> ?minInc }
     OPTIONAL { ?ps <${SH.maxInclusive}> ?maxInc }
     OPTIONAL { ?ps <${SH.pattern}> ?pattern }
     OPTIONAL { ?ps <${DASH.singleLine}> ?singleLine }
     OPTIONAL { ?ps <${SH.maxLength}> ?maxLen }
     OPTIONAL { ?ps <https://studio.local/ns#codelist> ?codelist }`,
      graph,
  )}
  FILTER(isIRI(?path))
}
ORDER BY ?shape ?order`;
    const r = await select(ep, q);

    const byShape = new Map<string, NodeShapeInfo>();
    const seenPs = new Set<string>();
    for (const b of r.bindings) {
        if (!b.shape || !b.target || !b.path) continue;
        const shapeIri = b.shape.value;
        if (!byShape.has(shapeIri)) {
            byShape.set(shapeIri, { iri: shapeIri, targetClass: b.target.value, properties: [] });
        }
        const psKey = `${shapeIri}|${b.ps?.value ?? b.path.value}`;
        if (seenPs.has(psKey)) continue;
        seenPs.add(psKey);
        byShape.get(shapeIri)!.properties.push({
            shapeIri,
            path: b.path.value,
            name: b.name?.value ?? null,
            description: b.desc?.value ?? null,
            datatype: b.datatype?.value ?? null,
            classIri: b.cls?.value ?? null,
            nodeKind: b.nodeKind?.value ?? null,
            minCount: b.minCount ? Number(b.minCount.value) : null,
            maxCount: b.maxCount ? Number(b.maxCount.value) : null,
            order: b.order ? Number(b.order.value) : 9999,
            minInclusive: b.minInc?.value ?? null,
            maxInclusive: b.maxInc?.value ?? null,
            pattern: b.pattern?.value ?? null,
            singleLine: b.singleLine ? b.singleLine.value === 'true' : null,
            codelist: b.codelist?.value ?? null,
            maxLength: b.maxLen ? Number(b.maxLen.value) : null,
            inValues: null,
        });
    }
    for (const s of byShape.values()) s.properties.sort((a, b) => a.order - b.order);
    const shapes = [...byShape.values()];
    const inLists = await fetchInLists(
        ep,
        graph,
        shapes.map((s) => s.iri),
    );
    for (const s of shapes) for (const p of s.properties) p.inValues = inLists.get(`${s.iri}|${p.path}`) ?? null;
    return shapes;
}

/** Fetch the property shapes of one node shape (for the shape editor). */
export async function fetchShape(ep: Endpoint, graph: string | null, shapeIri: string): Promise<NodeShapeInfo | null> {
    const q = `
SELECT ?target ?ps ?path ?name ?desc ?datatype ?cls ?nodeKind ?minCount ?maxCount ?order ?minInc ?maxInc ?pattern ?singleLine ?maxLen ?codelist WHERE {
  ${scoped(
      `OPTIONAL { <${shapeIri}> <${SH.targetClass}> ?target }
     <${shapeIri}> <${SH.property}> ?ps .
     ?ps <${SH.path}> ?path .
     OPTIONAL { ?ps <${SH.name}> ?name }
     OPTIONAL { ?ps <${SH.description}> ?desc }
     OPTIONAL { ?ps <${SH.datatype}> ?datatype }
     OPTIONAL { ?ps <${SH.class}> ?cls }
     OPTIONAL { ?ps <${SH.nodeKind}> ?nodeKind }
     OPTIONAL { ?ps <${SH.minCount}> ?minCount }
     OPTIONAL { ?ps <${SH.maxCount}> ?maxCount }
     OPTIONAL { ?ps <${SH.order}> ?order }
     OPTIONAL { ?ps <${SH.minInclusive}> ?minInc }
     OPTIONAL { ?ps <${SH.maxInclusive}> ?maxInc }
     OPTIONAL { ?ps <${SH.pattern}> ?pattern }
     OPTIONAL { ?ps <${DASH.singleLine}> ?singleLine }
     OPTIONAL { ?ps <${SH.maxLength}> ?maxLen }
     OPTIONAL { ?ps <https://studio.local/ns#codelist> ?codelist }`,
      graph,
  )}
  FILTER(isIRI(?path))
}
ORDER BY ?order`;
    const r = await select(ep, q);
    if (r.bindings.length === 0) return null;
    const seen = new Set<string>();
    const info: NodeShapeInfo = {
        iri: shapeIri,
        targetClass: r.bindings.find((b) => b.target)?.target?.value ?? '',
        properties: [],
    };
    for (const b of r.bindings) {
        if (!b.path) continue;
        const key = b.ps?.value ?? b.path.value;
        if (seen.has(key)) continue;
        seen.add(key);
        info.properties.push({
            shapeIri,
            path: b.path.value,
            name: b.name?.value ?? null,
            description: b.desc?.value ?? null,
            datatype: b.datatype?.value ?? null,
            classIri: b.cls?.value ?? null,
            nodeKind: b.nodeKind?.value ?? null,
            minCount: b.minCount ? Number(b.minCount.value) : null,
            maxCount: b.maxCount ? Number(b.maxCount.value) : null,
            order: b.order ? Number(b.order.value) : 9999,
            minInclusive: b.minInc?.value ?? null,
            maxInclusive: b.maxInc?.value ?? null,
            pattern: b.pattern?.value ?? null,
            singleLine: b.singleLine ? b.singleLine.value === 'true' : null,
            codelist: b.codelist?.value ?? null,
            maxLength: b.maxLen ? Number(b.maxLen.value) : null,
            inValues: null,
        });
    }
    info.properties.sort((a, b) => a.order - b.order);
    const inLists = await fetchInLists(ep, graph, [shapeIri]);
    for (const p of info.properties) p.inValues = inLists.get(`${shapeIri}|${p.path}`) ?? null;
    return info;
}

/** List all node shapes in scope (for the Shapes panel). */
export async function listNodeShapes(
    ep: Endpoint,
    graph: string | null,
): Promise<{ iri: string; targetClass: string | null; propertyCount: number }[]> {
    const q = `
SELECT ?shape (SAMPLE(?target) AS ?t) (COUNT(DISTINCT ?ps) AS ?n) WHERE {
  ${scoped(
      `{ ?shape a <${SH.NodeShape}> } UNION { ?shape <${SH.property}> ?anyPs }
     OPTIONAL { ?shape <${SH.targetClass}> ?target }
     OPTIONAL { ?shape <${SH.property}> ?ps }`,
      graph,
  )}
  FILTER(isIRI(?shape))
}
GROUP BY ?shape ORDER BY ?shape`;
    const r = await select(ep, q);
    return r.bindings
        .filter((b) => b.shape)
        .map((b) => ({
            iri: b.shape.value,
            targetClass: b.t?.value ?? null,
            propertyCount: Number(b.n?.value ?? 0),
        }));
}

/** Map an xsd datatype to the input kind used by parseTermInput. */
export function datatypeToKind(
    datatype: string | null,
): 'auto' | 'string' | 'integer' | 'decimal' | 'boolean' | 'date' | 'dateTime' {
    if (!datatype) return 'auto';
    const local = datatype.split('#').pop() ?? '';
    switch (local) {
        case 'integer':
        case 'int':
        case 'long':
        case 'nonNegativeInteger':
        case 'positiveInteger':
            return 'integer';
        case 'decimal':
        case 'float':
        case 'double':
            return 'decimal';
        case 'boolean':
            return 'boolean';
        case 'date':
            return 'date';
        case 'dateTime':
            return 'dateTime';
        default:
            return 'string';
    }
}
