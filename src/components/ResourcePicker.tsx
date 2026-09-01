// Searchable dropdown of existing resources: instances of a class when one is
// known (sh:class / rdfs:range), otherwise a global label/IRI search.

import { useEffect, useState } from 'react';
import { useConnection } from '../state/connection';
import { useGraph } from '../state/graph';
import { fetchInstances, searchResources, type InstanceInfo } from '../rdf/queries';
import { displayName } from '../rdf/display';

export function ResourcePicker({
    classIri,
    onPick,
    onCancel,
}: {
    classIri?: string | null;
    onPick: (iri: string) => void;
    onCancel: () => void;
}) {
    const conn = useConnection();
    const { prefixes } = useGraph();
    const [search, setSearch] = useState('');
    const [options, setOptions] = useState<InstanceInfo[] | null>(null);
    const [highlight, setHighlight] = useState(0);

    useEffect(() => {
        const ep = conn.active();
        if (!ep) return;
        let cancelled = false;
        const t = setTimeout(() => {
            const fetch = classIri
                ? fetchInstances(ep, conn.activeGraph, classIri, search.trim(), 50)
                : search.trim().length >= 2
                  ? searchResources(ep, conn.activeGraph, search.trim(), 50)
                  : Promise.resolve([] as InstanceInfo[]);
            fetch.then((r) => !cancelled && (setOptions(r), setHighlight(0))).catch(() => !cancelled && setOptions([]));
        }, 200);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search, classIri, conn.activeId, conn.activeGraph]);

    const shown = options ?? [];

    return (
        <div className="picker">
            <input
                autoFocus
                placeholder={classIri ? `search ${prefixes.shrink(classIri)}…` : 'search resources…'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') onCancel();
                    if (e.key === 'ArrowDown') setHighlight((h) => Math.min(h + 1, shown.length - 1));
                    if (e.key === 'ArrowUp') setHighlight((h) => Math.max(h - 1, 0));
                    if (e.key === 'Enter' && shown[highlight]) onPick(shown[highlight].iri);
                }}
                style={{ width: '100%' }}
            />
            <ul className="picker-list">
                {shown.map((o, i) => (
                    <li
                        key={o.iri}
                        className={i === highlight ? 'active' : ''}
                        title={o.iri}
                        onMouseEnter={() => setHighlight(i)}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            onPick(o.iri);
                        }}
                    >
                        {displayName(o.iri, o.label)}
                        {o.label && <span className="term-meta"> {prefixes.shrink(o.iri)}</span>}
                    </li>
                ))}
                {options !== null && shown.length === 0 && (
                    <li className="term-meta">
                        {classIri || search.trim().length >= 2 ? 'no matches' : 'type to search'}
                    </li>
                )}
            </ul>
            <button className="micro" onClick={onCancel} style={{ alignSelf: 'flex-end' }}>
                ✕ cancel
            </button>
        </div>
    );
}
