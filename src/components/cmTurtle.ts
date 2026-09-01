// CodeMirror setup for the Turtle source editor: legacy turtle stream mode
// for highlighting, a completion source that knows the graph (prefixes,
// classes, properties, plus every term already in the document), and a theme
// wired to the design-system variables.

import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { StreamLanguage, syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { turtle } from '@codemirror/legacy-modes/mode/turtle';
import {
    autocompletion,
    completionKeymap,
    type CompletionContext,
    type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';

export interface CompletionTerm {
    label: string;
    detail?: string;
    type?: string;
}

const TURTLE_KEYWORDS: CompletionTerm[] = [
    { label: '@prefix', type: 'keyword' },
    { label: '@base', type: 'keyword' },
    { label: 'a', detail: 'rdf:type', type: 'keyword' },
];

const COMMON_TERMS: CompletionTerm[] = [
    { label: 'rdfs:label', type: 'property' },
    { label: 'rdfs:comment', type: 'property' },
    { label: 'rdfs:subClassOf', type: 'property' },
    { label: 'rdfs:Class', type: 'class' },
    { label: 'skos:prefLabel', type: 'property' },
    { label: 'skos:altLabel', type: 'property' },
    { label: 'skos:definition', type: 'property' },
    { label: 'skos:broader', type: 'property' },
    { label: 'skos:inScheme', type: 'property' },
    { label: 'skos:Concept', type: 'class' },
    { label: 'sh:NodeShape', type: 'class' },
    { label: 'sh:property', type: 'property' },
    { label: 'sh:path', type: 'property' },
    { label: 'sh:datatype', type: 'property' },
    { label: 'sh:targetClass', type: 'property' },
    { label: 'xsd:string', type: 'type' },
    { label: 'xsd:integer', type: 'type' },
    { label: 'xsd:decimal', type: 'type' },
    { label: 'xsd:date', type: 'type' },
    { label: 'xsd:dateTime', type: 'type' },
    { label: 'xsd:boolean', type: 'type' },
];

/** Terms already used in the document: prefixed names and full IRIs. */
function docTerms(text: string): CompletionTerm[] {
    const out = new Map<string, CompletionTerm>();
    for (const m of text.matchAll(/(?<![\w<])([A-Za-z][\w-]*:[A-Za-z][\w-]*)/g)) {
        out.set(m[1], { label: m[1], type: 'variable', detail: 'in document' });
    }
    for (const m of text.matchAll(/<(https?:\/\/[^>\s]+)>/g)) {
        out.set(`<${m[1]}>`, { label: `<${m[1]}>`, type: 'variable', detail: 'in document' });
    }
    return [...out.values()];
}

export function turtleCompletions(graphTerms: () => CompletionTerm[]) {
    return (ctx: CompletionContext): CompletionResult | null => {
        const word = ctx.matchBefore(/[@\w<][\w:<>/.#-]*/);
        if (!word || (word.from === word.to && !ctx.explicit)) return null;
        const doc = ctx.state.doc.toString();
        const options = [...TURTLE_KEYWORDS, ...COMMON_TERMS, ...graphTerms(), ...docTerms(doc)];
        const seen = new Set<string>();
        return {
            from: word.from,
            options: options.filter((o) => (seen.has(o.label) ? false : (seen.add(o.label), true))),
            validFor: /^[@\w<][\w:<>/.#-]*$/,
        };
    };
}

const studioTheme = EditorView.theme({
    '&': { backgroundColor: 'var(--bg)', color: 'var(--text)', fontSize: '12px', height: '100%' },
    '.cm-content': { fontFamily: "'IBM Plex Mono', monospace", caretColor: 'var(--accent)' },
    '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--muted)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)',
    },
    '.cm-tooltip': { backgroundColor: 'var(--panel)', border: '1px solid var(--border)' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)',
        color: 'var(--text)',
    },
});

export function createTurtleEditor({
    parent,
    doc,
    onChange,
    graphTerms,
}: {
    parent: HTMLElement;
    doc: string;
    onChange: (text: string) => void;
    graphTerms: () => CompletionTerm[];
}): EditorView {
    const extensions: Extension[] = [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        bracketMatching(),
        StreamLanguage.define(turtle),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        autocompletion({ override: [turtleCompletions(graphTerms)], activateOnTyping: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap]),
        studioTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
            if (u.docChanged) onChange(u.state.doc.toString());
        }),
    ];
    return new EditorView({ state: EditorState.create({ doc, extensions }), parent });
}
