// Shape authoring: edit property-shape constraints (bnode-safe via
// DELETE/INSERT WHERE addressed through parent shape + sh:path), and generate
// a starter NodeShape by profiling instance data.

import type { Endpoint } from './sparqlClient';
import { SH } from './vocab';
import { select, update } from './sparqlClient';
import { scoped } from './queries';
import { useHistory } from '../state/history';
import { localName } from './prefixes';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

function wrap(graph: string | null, t: string): string {
  return graph ? `GRAPH <${graph}> { ${t} }` : t;
}

function lit(value: string, datatype?: string): string {
  const esc = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return datatype ? `"${esc}"^^<${datatype}>` : `"${esc}"`;
}

const XSD_INT = 'http://www.w3.org/2001/XMLSchema#integer';

/** Serialize a constraint value: integers for counts/order, IRIs for datatype/class, strings otherwise. */
function constraintValue(constraint: string, value: string): string {
  if (['minCount', 'maxCount', 'order'].includes(constraint)) return lit(value, XSD_INT);
  if (['datatype', 'class', 'nodeKind', 'path'].includes(constraint)) return `<${value}>`;
  return lit(value);
}

/**
 * Set (replace) a single constraint on the property shape identified by
 * (nodeShape, path) — works whether the property shape is an IRI or a bnode.
 * Empty value = remove the constraint. Undoable.
 */
export async function cmdSetConstraint(
  ep: Endpoint,
  graph: string | null,
  nodeShape: string,
  path: string,
  constraint: string, // local name: minCount, maxCount, name, datatype, class, order, pattern, description
  newValue: string | null,
  oldValue: string | null
): Promise<void> {
  const build = (value: string | null) => {
    const del = `?ps <${SH.NS}${constraint}> ?old .`;
    const ins = value !== null && value !== '' ? `?ps <${SH.NS}${constraint}> ${constraintValue(constraint, value)} .` : '';
    return `DELETE { ${wrap(graph, del)} }
${ins ? `INSERT { ${wrap(graph, ins)} }` : ''}
WHERE { ${wrap(
      graph,
      `<${nodeShape}> <${SH.property}> ?ps . ?ps <${SH.path}> <${path}> . OPTIONAL { ?ps <${SH.NS}${constraint}> ?old }`
    )} }`;
  };
  await useHistory.getState().exec({
    label: `set ${constraint}`,
    redo: () => update(ep, build(newValue)),
    undo: () => update(ep, build(oldValue)),
  });
}

/** Add a new property shape (minted IRI) to a node shape. Undoable. */
export async function cmdAddPropertyShape(
  ep: Endpoint,
  graph: string | null,
  nodeShape: string,
  path: string
): Promise<void> {
  const psIri = `${nodeShape}-p-${localName(path)}-${Math.floor(Math.random() * 10000)}`;
  const triples = `<${nodeShape}> <${SH.property}> <${psIri}> . <${psIri}> <${SH.path}> <${path}> .`;
  await useHistory.getState().exec({
    label: 'add property shape',
    redo: () => update(ep, `INSERT DATA { ${wrap(graph, triples)} }`),
    undo: () =>
      update(
        ep,
        `DELETE WHERE { ${wrap(graph, `<${nodeShape}> <${SH.property}> <${psIri}> . <${psIri}> ?p ?o .`)} }`
      ),
  });
}

/** Remove a property shape (all its triples + the sh:property link), addressed by path. Undoable via snapshot. */
export async function cmdRemovePropertyShape(
  ep: Endpoint,
  graph: string | null,
  nodeShape: string,
  path: string
): Promise<void> {
  // snapshot constraints for undo
  const snap = await select(
    ep,
    `SELECT ?c ?v WHERE { ${scoped(
      `<${nodeShape}> <${SH.property}> ?ps . ?ps <${SH.path}> <${path}> . ?ps ?c ?v .`,
      graph
    )} }`
  );
  const psTmp = `${nodeShape}-p-${localName(path)}-restored`;
  const restore = [
    `<${nodeShape}> <${SH.property}> <${psTmp}> .`,
    ...snap.bindings
      .filter((b) => b.c && b.v)
      .map((b) => {
        const v =
          b.v.type === 'uri'
            ? `<${b.v.value}>`
            : b.v.datatype
              ? lit(b.v.value, b.v.datatype)
              : lit(b.v.value);
        return `<${psTmp}> <${b.c.value}> ${v} .`;
      }),
  ].join('\n');
  const del = `DELETE { ${wrap(graph, `<${nodeShape}> <${SH.property}> ?ps . ?ps ?c ?v .`)} }
WHERE { ${wrap(graph, `<${nodeShape}> <${SH.property}> ?ps . ?ps <${SH.path}> <${path}> . ?ps ?c ?v .`)} }`;
  await useHistory.getState().exec({
    label: 'remove property shape',
    redo: () => update(ep, del),
    undo: () => update(ep, `INSERT DATA { ${wrap(graph, restore)} }`),
  });
}

export interface PredicateProfile {
  predicate: string;
  subjects: number;
  uses: number;
  datatype: string | null;
  objectClass: string | null;
}

/** Profile predicates used by instances of a class. */
export async function profileClass(
  ep: Endpoint,
  graph: string | null,
  classIri: string
): Promise<{ total: number; predicates: PredicateProfile[] }> {
  const totalR = await select(
    ep,
    `SELECT (COUNT(DISTINCT ?s) AS ?n) WHERE { ${scoped(`?s <${RDF_TYPE}> <${classIri}> .`, graph)} }`
  );
  const total = Number(totalR.bindings[0]?.n?.value ?? 0);
  const r = await select(
    ep,
    `SELECT ?p (COUNT(DISTINCT ?s) AS ?subjects) (COUNT(*) AS ?uses) (SAMPLE(?dt) AS ?sdt) (SAMPLE(?ocls) AS ?socls) WHERE {
  ${scoped(
    `?s <${RDF_TYPE}> <${classIri}> . ?s ?p ?o .
     BIND(IF(isLiteral(?o), DATATYPE(?o), ?undef) AS ?dt)
     OPTIONAL { FILTER(isIRI(?o)) ?o <${RDF_TYPE}> ?ocls }`,
    graph
  )}
  FILTER(?p != <${RDF_TYPE}>)
}
GROUP BY ?p ORDER BY DESC(?subjects)`
  );
  return {
    total,
    predicates: r.bindings
      .filter((b) => b.p)
      .map((b) => ({
        predicate: b.p.value,
        subjects: Number(b.subjects?.value ?? 0),
        uses: Number(b.uses?.value ?? 0),
        datatype: b.sdt?.value ?? null,
        objectClass: b.socls?.value ?? null,
      })),
  };
}

/** Generate a starter NodeShape from a class profile. Undoable. Returns the shape IRI. */
export async function cmdGenerateShape(
  ep: Endpoint,
  graph: string | null,
  classIri: string
): Promise<string> {
  const { total, predicates } = await profileClass(ep, graph, classIri);
  const shapeIri = `${classIri}Shape`;
  const lines: string[] = [
    `<${shapeIri}> <${RDF_TYPE}> <${SH.NodeShape}> .`,
    `<${shapeIri}> <${SH.targetClass}> <${classIri}> .`,
  ];
  predicates.forEach((p, i) => {
    const ps = `${shapeIri}-p-${localName(p.predicate)}`;
    lines.push(`<${shapeIri}> <${SH.property}> <${ps}> .`);
    lines.push(`<${ps}> <${SH.path}> <${p.predicate}> .`);
    lines.push(`<${ps}> <${SH.order}> ${lit(String(i + 1), XSD_INT)} .`);
    if (p.datatype) lines.push(`<${ps}> <${SH.datatype}> <${p.datatype}> .`);
    else if (p.objectClass) lines.push(`<${ps}> <${SH.class}> <${p.objectClass}> .`);
    if (total > 0 && p.subjects === total) lines.push(`<${ps}> <${SH.minCount}> ${lit('1', XSD_INT)} .`);
    if (p.uses === p.subjects) lines.push(`<${ps}> <${SH.maxCount}> ${lit('1', XSD_INT)} .`);
  });
  const block = lines.join('\n');
  await useHistory.getState().exec({
    label: 'generate shape',
    redo: () => update(ep, `INSERT DATA { ${wrap(graph, block)} }`),
    undo: () => update(ep, `DELETE DATA { ${wrap(graph, block)} }`),
  });
  return shapeIri;
}
