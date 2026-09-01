// Prefix registry + curie rendering. Defaults cover the working vocabularies;
// data-discovered namespaces get registered at hydrate time.

export const DEFAULT_PREFIXES: Record<string, string> = {
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
    owl: 'http://www.w3.org/2002/07/owl#',
    sh: 'http://www.w3.org/ns/shacl#',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    skos: 'http://www.w3.org/2004/02/skos/core#',
    dcterms: 'http://purl.org/dc/terms/',
    dash: 'http://datashapes.org/dash#',
    foaf: 'http://xmlns.com/foaf/0.1/',
    schema: 'https://schema.org/',
    prov: 'http://www.w3.org/ns/prov#',
};

export class PrefixMap {
    private byPrefix = new Map<string, string>();
    private sorted: [string, string][] = []; // [namespace, prefix] longest-first

    constructor(initial: Record<string, string> = DEFAULT_PREFIXES) {
        for (const [p, ns] of Object.entries(initial)) this.byPrefix.set(p, ns);
        this.reindex();
    }

    private reindex() {
        this.sorted = [...this.byPrefix.entries()]
            .map(([p, ns]) => [ns, p] as [string, string])
            .sort((a, b) => b[0].length - a[0].length);
    }

    register(prefix: string, namespace: string) {
        if (!this.byPrefix.has(prefix)) {
            this.byPrefix.set(prefix, namespace);
            this.reindex();
        }
    }

    /** Auto-register the namespace of an IRI with a generated prefix (e.g. …/music# → music:). */
    learnNamespace(iri: string) {
        const m = iri.match(/^(.*[#/])[^#/]*$/);
        if (!m) return;
        const ns = m[1];
        if (ns.length < 10) return; // ignore junk like "urn:"
        if (this.sorted.some(([existing]) => existing === ns)) return;
        const seg =
            ns
                .replace(/[#/]+$/, '')
                .split(/[#/:.]/)
                .filter((s) => s && !['www', 'com', 'org', 'net', 'io', 'http', 'https', 'example'].includes(s))
                .pop() ?? 'ns';
        let candidate =
            seg
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '')
                .slice(0, 12) || 'ns';
        if (/^\d/.test(candidate)) candidate = `n${candidate}`;
        let unique = candidate;
        let i = 2;
        while (this.byPrefix.has(unique)) unique = `${candidate}${i++}`;
        this.byPrefix.set(unique, ns);
        this.reindex();
    }

    entries(): Record<string, string> {
        return Object.fromEntries(this.byPrefix);
    }

    /** Shrink an IRI to a curie if a registered namespace matches; else return as-is. */
    shrink(iri: string): string {
        for (const [ns, p] of this.sorted) {
            if (iri.startsWith(ns)) {
                const local = iri.slice(ns.length);
                if (/^[A-Za-z_][\w.-]*$/.test(local) || local === '') return `${p}:${local}`;
            }
        }
        return iri;
    }

    /** Expand a curie to a full IRI; passthrough for full IRIs. */
    expand(curieOrIri: string): string {
        const m = curieOrIri.match(/^([A-Za-z_][\w-]*):(.*)$/);
        if (m && !curieOrIri.includes('//')) {
            const ns = this.byPrefix.get(m[1]);
            if (ns) return ns + m[2];
        }
        return curieOrIri;
    }

    sparqlPreamble(): string {
        return [...this.byPrefix.entries()].map(([p, ns]) => `PREFIX ${p}: <${ns}>`).join('\n');
    }
}

/** Best-effort human label from an IRI (last path/fragment segment, decamelized lightly). */
export function localName(iri: string): string {
    const frag = iri.split(/[#/]/).filter(Boolean).pop() ?? iri;
    return decodeURIComponent(frag);
}
