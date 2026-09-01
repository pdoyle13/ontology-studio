// User-configurable app settings, persisted in the extensions graph so they
// travel with the deployment (journaled + snapshotted like all meta). Each
// setting is a JSON literal on the singleton config node. Defaults live here;
// the graph only stores overrides.

import { create } from 'zustand';
import type { Endpoint } from '../rdf/sparqlClient';
import { select, update } from '../rdf/sparqlClient';

const STUDIO = 'https://studio.local/ns#';
const EXT_GRAPH = 'https://studio.local/graphs/extensions';
const CONFIG_NODE = 'https://studio.local/config#app';
const P_SYSTEM_NS = `${STUDIO}settingSystemNamespaces`;

/** System machinery namespaces hidden from the Classes tree by default.
 *  Each has its own home surface (Taxonomy, Shapes, Assets, Reviews, …). */
export const DEFAULT_SYSTEM_NAMESPACES = [
    'http://www.w3.org/2004/02/skos/core#',
    'http://www.w3.org/ns/shacl#',
    'http://www.w3.org/ns/r2rml#',
    'http://www.w3.org/ns/prov#',
    'http://datashapes.org/dash#',
    'http://www.w3.org/2002/07/owl#',
    'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    'http://www.w3.org/2000/01/rdf-schema#',
];

interface SettingsState {
    systemNamespaces: string[];
    loaded: boolean;
    load: (ep: Endpoint) => Promise<void>;
    saveSystemNamespaces: (ep: Endpoint, ns: string[]) => Promise<void>;
}

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

export const useSettings = create<SettingsState>((set) => ({
    systemNamespaces: DEFAULT_SYSTEM_NAMESPACES,
    loaded: false,

    load: async (ep) => {
        try {
            const r = await select(
                ep,
                `SELECT ?v WHERE { GRAPH <${EXT_GRAPH}> { <${CONFIG_NODE}> <${P_SYSTEM_NS}> ?v } } LIMIT 1`,
            );
            const raw = r.bindings[0]?.v?.value;
            const parsed = raw ? JSON.parse(raw) : null;
            set({
                systemNamespaces:
                    Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')
                        ? parsed
                        : DEFAULT_SYSTEM_NAMESPACES,
                loaded: true,
            });
        } catch {
            set({ systemNamespaces: DEFAULT_SYSTEM_NAMESPACES, loaded: true });
        }
    },

    saveSystemNamespaces: async (ep, ns) => {
        const clean = ns.map((n) => n.trim()).filter(Boolean);
        await update(
            ep,
            `DELETE WHERE { GRAPH <${EXT_GRAPH}> { <${CONFIG_NODE}> <${P_SYSTEM_NS}> ?v } } ;
INSERT DATA { GRAPH <${EXT_GRAPH}> { <${CONFIG_NODE}> <${P_SYSTEM_NS}> "${esc(JSON.stringify(clean))}" } }`,
        );
        set({ systemNamespaces: clean });
    },
}));
