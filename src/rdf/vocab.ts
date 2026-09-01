// Vocabulary constants: every SHACL/DASH term the app touches, as full IRIs.
// Import these instead of string-concatenating a namespace prefix — typos
// become compile errors and usages are greppable by term.

const sh = (local: string) => `http://www.w3.org/ns/shacl#${local}` as const;
const dash = (local: string) => `http://datashapes.org/dash#${local}` as const;

export const SH = {
    NS: 'http://www.w3.org/ns/shacl#',
    // classes
    NodeShape: sh('NodeShape'),
    PropertyShape: sh('PropertyShape'),
    TripleRule: sh('TripleRule'),
    SPARQLRule: sh('SPARQLRule'),
    // shape structure
    property: sh('property'),
    path: sh('path'),
    targetClass: sh('targetClass'),
    // property-shape constraints
    name: sh('name'),
    description: sh('description'),
    datatype: sh('datatype'),
    class: sh('class'),
    nodeKind: sh('nodeKind'),
    minCount: sh('minCount'),
    maxCount: sh('maxCount'),
    order: sh('order'),
    minInclusive: sh('minInclusive'),
    maxInclusive: sh('maxInclusive'),
    pattern: sh('pattern'),
    maxLength: sh('maxLength'),
    in: sh('in'),
    // rules (SHACL-AF)
    rule: sh('rule'),
    construct: sh('construct'),
    deactivated: sh('deactivated'),
    subject: sh('subject'),
    predicate: sh('predicate'),
    object: sh('object'),
    this: sh('this'),
} as const;

export const DASH = {
    NS: 'http://datashapes.org/dash#',
    singleLine: dash('singleLine'),
    propertyRole: dash('propertyRole'),
    LabelRole: dash('LabelRole'),
} as const;
