import { useEffect, useState } from 'react';
import { useGraph } from '../state/graph';
import { useCanvas } from '../state/canvas';
import { useConnection } from '../state/connection';
import { fetchInstances, searchResources, type InstanceInfo } from '../rdf/queries';
import { displayName } from '../rdf/display';
import { openDataGrid } from './DataGrid';
import { virtualClasses } from '../rdf/virtualApi';

/** Drag source: carries the resource IRI to the canvas drop handler. */
export const dragIri = (e: React.DragEvent, iri: string) => {
    e.dataTransfer.setData('application/x-studio-iri', iri);
    e.dataTransfer.effectAllowed = 'copy';
};

const toCanvas = (iri: string) => useCanvas.getState().addResource(iri, undefined, { focus: true });

const TREE_PAGE = 50;

function InstanceList({ classIri }: { classIri: string }) {
    const conn = useConnection();
    const { selected, selectResource } = useGraph();
    const [instances, setInstances] = useState<InstanceInfo[] | null>(null);
    const [shown, setShown] = useState(TREE_PAGE);

    useEffect(() => {
        const ep = conn.active();
        if (!ep) return;
        let cancelled = false;
        setShown(TREE_PAGE);
        fetchInstances(ep, conn.activeGraph, classIri, '', 1000).then((r) => {
            if (!cancelled) setInstances(r);
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [classIri, conn.activeId, conn.activeGraph]);

    if (!instances) return <div className="tree-loading">loading…</div>;
    return (
        <ul className="instance-list">
            {instances.slice(0, shown).map((i) => (
                <li
                    key={i.iri}
                    className={selected === i.iri ? 'selected' : ''}
                    title={i.iri}
                    draggable
                    onDragStart={(e) => dragIri(e, i.iri)}
                    onClick={() => selectResource(i.iri)}
                    onDoubleClick={() => toCanvas(i.iri)}
                >
                    {displayName(i.iri, i.label)}
                </li>
            ))}
            {instances.length === 0 && <li className="tree-loading">no instances</li>}
            {instances.length > shown && (
                <li className="tree-loading">
                    <button className="micro" onClick={() => setShown((n) => n + TREE_PAGE)}>
                        + {Math.min(TREE_PAGE, instances.length - shown)} more ({instances.length - shown} hidden)
                    </button>
                </li>
            )}
        </ul>
    );
}

export function ClassTree() {
    const conn = useConnection();
    const { classes, classesLoading, selectResource, selected, loadClasses } = useGraph();
    const [virtualSet, setVirtualSet] = useState<Set<string>>(new Set());
    useEffect(() => {
        virtualClasses()
            .then((v) => setVirtualSet(new Set(v.map((x) => x.classIri))))
            .catch(() => {});
    }, [conn.activeId, conn.activeGraph]);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState('');
    const [results, setResults] = useState<InstanceInfo[] | null>(null);

    useEffect(() => {
        if (conn.status === 'connected' && classes.length === 0 && !classesLoading) loadClasses();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conn.status]);

    useEffect(() => {
        const ep = conn.active();
        if (!ep || search.trim().length < 2) {
            setResults(null);
            return;
        }
        const t = setTimeout(() => {
            searchResources(ep, conn.activeGraph, search.trim())
                .then(setResults)
                .catch(() => setResults([]));
        }, 250);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search, conn.activeId, conn.activeGraph]);

    if (conn.status !== 'connected') return <div className="placeholder">Connect to an endpoint to browse</div>;

    return (
        <div className="class-tree">
            <input
                className="search-box"
                placeholder="Search resources…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
            />
            {results !== null ? (
                <ul className="instance-list">
                    {results.map((r) => (
                        <li
                            key={r.iri}
                            className={selected === r.iri ? 'selected' : ''}
                            title={r.iri}
                            draggable
                            onDragStart={(e) => dragIri(e, r.iri)}
                            onClick={() => selectResource(r.iri)}
                            onDoubleClick={() => toCanvas(r.iri)}
                        >
                            {displayName(r.iri, r.label)}
                        </li>
                    ))}
                    {results.length === 0 && <li className="tree-loading">no matches</li>}
                </ul>
            ) : classesLoading ? (
                <div className="tree-loading">loading classes…</div>
            ) : (
                <ul className="class-list">
                    {classes.map((c) => {
                        const open = expanded.has(c.iri);
                        return (
                            <li key={c.iri}>
                                <div
                                    className={`class-row ${selected === c.iri ? 'selected' : ''}`}
                                    onClick={() => {
                                        const next = new Set(expanded);
                                        if (open) next.delete(c.iri);
                                        else next.add(c.iri);
                                        setExpanded(next);
                                    }}
                                >
                                    <span className="twisty">{open ? '▾' : '▸'}</span>
                                    <span
                                        className="class-name"
                                        title={c.iri}
                                        draggable
                                        onDragStart={(e) => dragIri(e, c.iri)}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            selectResource(c.iri);
                                        }}
                                        onDoubleClick={(e) => {
                                            e.stopPropagation();
                                            toCanvas(c.iri);
                                        }}
                                    >
                                        {displayName(c.iri, c.label)}
                                    </span>
                                    {virtualSet.has(c.iri) && (
                                        <button
                                            className="micro"
                                            title="Browse live data (grid)"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openDataGrid(c.iri);
                                            }}
                                        >
                                            ⊞
                                        </button>
                                    )}
                                    <span className="count">{c.instances}</span>
                                </div>
                                {open && <InstanceList classIri={c.iri} />}
                            </li>
                        );
                    })}
                    {classes.length === 0 && <div className="tree-loading">no classes found in this scope</div>}
                </ul>
            )}
        </div>
    );
}
