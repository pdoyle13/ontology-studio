// Asset-type registry: an asset type is DATA, not code — a record in the
// extensions graph naming its class, presentation, and placement. Built-ins
// (taxonomy, glossary, business objects, physical objects, mappings) are
// virtual rows merged with user-defined types; everything downstream (sidebar,
// create dialogs, search, import) renders from this registry.

import type { Endpoint } from './sparqlClient';
import { select, update } from './sparqlClient';
import { serializeTerm } from './mutations';
import { useHistory } from '../state/history';
import { EXT_GRAPH, slug } from './skosExt';

const STUDIO = 'https://studio.local/ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';

export type Presentation = 'tree' | 'list' | 'table' | 'catalog';

export interface AssetTypeDef {
    iri: string;
    label: string;
    description: string | null;
    classIri: string;
    presentation: Presentation;
    builtin: boolean;
    order: number;
}

/** Built-ins are code-defined defaults; user types come from the graph. */
export function builtinAssetTypes(): AssetTypeDef[] {
    const b = (
        label: string,
        classIri: string,
        presentation: Presentation,
        order: number,
        description: string,
    ): AssetTypeDef => ({
        iri: `${STUDIO}assetType/${slug(label)}`,
        label,
        description,
        classIri,
        presentation,
        builtin: true,
        order,
    });
    return [
        b(
            'Taxonomies',
            'http://www.w3.org/2004/02/skos/core#ConceptScheme',
            'tree',
            1,
            'Hierarchical vocabularies (broader/narrower).',
        ),
        b(
            'Business glossaries',
            `${STUDIO}Glossary`,
            'list',
            2,
            'Agreed business terms with definitions and stewards.',
        ),
        b(
            'Business objects',
            `${STUDIO}BusinessObject`,
            'catalog',
            3,
            'Enterprise logical entities aligned to business areas across sources.',
        ),
        b(
            'Physical objects',
            `${STUDIO}PhysicalObject`,
            'catalog',
            4,
            'Tables and columns of attached databases, as searchable assets.',
        ),
        b(
            'Mappings',
            'http://www.w3.org/ns/r2rml#TriplesMap',
            'catalog',
            5,
            'Physical-to-logical R2RML bindings, browsable and governable.',
        ),
    ];
}

export async function listAssetTypes(ep: Endpoint): Promise<AssetTypeDef[]> {
    const q = `
SELECT ?t ?label ?desc ?cls ?pres ?order WHERE {
  GRAPH <${EXT_GRAPH}> {
    ?t a <${STUDIO}AssetType> ;
       <${RDFS}label> ?label ;
       <${STUDIO}assetClass> ?cls .
    OPTIONAL { ?t <${RDFS}comment> ?desc }
    OPTIONAL { ?t <${STUDIO}presentation> ?pres }
    OPTIONAL { ?t <${STUDIO}order> ?order }
  }
}
ORDER BY ?order ?label`;
    let custom: AssetTypeDef[] = [];
    try {
        const r = await select(ep, q);
        custom = r.bindings
            .filter((b) => b.t && b.label && b.cls)
            .map((b) => ({
                iri: b.t.value,
                label: b.label.value,
                description: b.desc?.value ?? null,
                classIri: b.cls.value,
                presentation: (b.pres?.value as Presentation) ?? 'list',
                builtin: false,
                order: b.order ? Number(b.order.value) : 50,
            }));
    } catch {
        /* extensions graph may not exist yet */
    }
    return [...builtinAssetTypes(), ...custom].sort((a, b) => a.order - b.order);
}

export interface NewAssetType {
    label: string;
    description?: string;
    /** blank mints studio.local/ns#<slug> and declares it a class */
    classIri?: string;
    presentation: Presentation;
}

export async function cmdCreateAssetType(ep: Endpoint, spec: NewAssetType): Promise<string> {
    const typeIri = `${STUDIO}assetType/${slug(spec.label)}`;
    const classIri =
        spec.classIri?.trim() ||
        `${STUDIO}${slug(spec.label).replace(/(^|-)(\w)/g, (_m, _d, c: string) => c.toUpperCase())}`;
    const t = [
        `<${typeIri}> a <${STUDIO}AssetType> .`,
        `<${typeIri}> <${RDFS}label> ${serializeTerm({ type: 'literal', value: spec.label })} .`,
        `<${typeIri}> <${STUDIO}assetClass> <${classIri}> .`,
        `<${typeIri}> <${STUDIO}presentation> ${serializeTerm({ type: 'literal', value: spec.presentation })} .`,
        `<${typeIri}> <${STUDIO}order> "50"^^<http://www.w3.org/2001/XMLSchema#integer> .`,
    ];
    if (spec.description?.trim())
        t.push(`<${typeIri}> <${RDFS}comment> ${serializeTerm({ type: 'literal', value: spec.description.trim() })} .`);
    if (!spec.classIri?.trim()) {
        t.push(`<${classIri}> a <${RDFS}Class> .`);
        t.push(
            `<${classIri}> <${RDFS}label> ${serializeTerm({ type: 'literal', value: spec.label.replace(/s$/, '') })} .`,
        );
    }
    const block = t.join('\n');
    await useHistory.getState().exec({
        label: 'create asset type',
        redo: () => update(ep, `INSERT DATA { GRAPH <${EXT_GRAPH}> { ${block} } }`),
        undo: () => update(ep, `DELETE DATA { GRAPH <${EXT_GRAPH}> { ${block} } }`),
    });
    return typeIri;
}

export async function cmdDeleteAssetType(ep: Endpoint, typeIri: string): Promise<void> {
    const r = await select(ep, `SELECT ?p ?o WHERE { GRAPH <${EXT_GRAPH}> { <${typeIri}> ?p ?o } }`);
    const snapshot = r.bindings
        .map(
            (b) =>
                `<${typeIri}> <${b.p.value}> ${b.o.type === 'uri' ? `<${b.o.value}>` : serializeTerm({ type: 'literal', value: b.o.value, datatype: (b.o as { datatype?: string }).datatype })} .`,
        )
        .join('\n');
    await useHistory.getState().exec({
        label: 'delete asset type',
        redo: () => update(ep, `DELETE WHERE { GRAPH <${EXT_GRAPH}> { <${typeIri}> ?p ?o } }`),
        undo: () => update(ep, `INSERT DATA { GRAPH <${EXT_GRAPH}> { ${snapshot} } }`),
    });
}
