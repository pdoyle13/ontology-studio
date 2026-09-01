// Constraint sheet editor for a NodeShape: edit property-shape constraints
// through form fields (bnode-safe), add/remove property shapes.

import { useCallback, useEffect, useState } from 'react';
import { useConnection } from '../state/connection';
import { useGraph } from '../state/graph';
import { fetchShape, type NodeShapeInfo, type PropertyShapeInfo } from '../rdf/shacl';
import { cmdSetConstraint, cmdAddPropertyShape, cmdRemovePropertyShape } from '../rdf/shapeGen';

const EDITABLE: { key: keyof PropertyShapeInfo; constraint: string; placeholder: string; size: number }[] = [
    { key: 'name', constraint: 'name', placeholder: 'name', size: 12 },
    { key: 'datatype', constraint: 'datatype', placeholder: 'xsd datatype IRI/curie', size: 14 },
    { key: 'classIri', constraint: 'class', placeholder: 'class IRI/curie', size: 14 },
    { key: 'minCount', constraint: 'minCount', placeholder: 'min', size: 3 },
    { key: 'maxCount', constraint: 'maxCount', placeholder: 'max', size: 3 },
    { key: 'order', constraint: 'order', placeholder: 'order', size: 3 },
    { key: 'pattern', constraint: 'pattern', placeholder: 'regex pattern', size: 12 },
];

function ConstraintInput({
    shape,
    ps,
    field,
}: {
    shape: string;
    ps: PropertyShapeInfo;
    field: (typeof EDITABLE)[number];
}) {
    const conn = useConnection();
    const { prefixes } = useGraph();
    const raw = ps[field.key];
    const current = raw === null || raw === undefined ? '' : String(raw);
    const display =
        field.constraint === 'datatype' || field.constraint === 'class'
            ? current
                ? prefixes.shrink(current)
                : ''
            : current === '9999' && field.constraint === 'order'
              ? ''
              : current;
    const [value, setValue] = useState(display);

    useEffect(() => setValue(display), [display]);

    const commit = () => {
        const ep = conn.active();
        if (!ep || value === display) return;
        let v: string | null = value.trim() || null;
        if (v && (field.constraint === 'datatype' || field.constraint === 'class')) v = prefixes.expand(v);
        const old = current || null;
        cmdSetConstraint(ep, conn.activeGraph, shape, ps.path, field.constraint, v, old).catch((e) =>
            window.alert((e as Error).message),
        );
    };

    return (
        <input
            className="constraint-input"
            size={field.size}
            placeholder={field.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
    );
}

export function ShapeEditor({ shapeIri }: { shapeIri: string }) {
    const conn = useConnection();
    const { prefixes, selectResource } = useGraph();
    const [shape, setShape] = useState<NodeShapeInfo | null>(null);
    const [version, setVersion] = useState(0);
    const [newPath, setNewPath] = useState('');

    const reload = useCallback(() => setVersion((v) => v + 1), []);

    useEffect(() => {
        const ep = conn.active();
        if (!ep) return;
        let cancelled = false;
        fetchShape(ep, conn.activeGraph, shapeIri)
            .then((s) => !cancelled && setShape(s))
            .catch(() => !cancelled && setShape(null));
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shapeIri, conn.activeId, conn.activeGraph, version]);

    if (!shape) return null;

    const addPath = () => {
        const ep = conn.active();
        if (!ep || !newPath.trim()) return;
        cmdAddPropertyShape(ep, conn.activeGraph, shapeIri, prefixes.expand(newPath.trim()))
            .then(reload)
            .catch((e) => window.alert((e as Error).message));
        setNewPath('');
    };

    return (
        <div className="shape-editor">
            <div className="panel-title">
                Shape editor{' '}
                {shape.targetClass && (
                    <>
                        — targets{' '}
                        <a className="term-link" onClick={() => selectResource(shape.targetClass)}>
                            {prefixes.shrink(shape.targetClass)}
                        </a>
                    </>
                )}
            </div>
            {shape.properties.map((ps) => (
                <div key={ps.path} className="ps-row">
                    <div className="ps-path">
                        <a className="term-link" title={ps.path} onClick={() => selectResource(ps.path)}>
                            {prefixes.shrink(ps.path)}
                        </a>
                        <button
                            className="micro danger"
                            title="Remove property shape"
                            onClick={() => {
                                const ep = conn.active();
                                if (!ep) return;
                                if (!window.confirm(`Remove property shape for ${prefixes.shrink(ps.path)}?`)) return;
                                cmdRemovePropertyShape(ep, conn.activeGraph, shapeIri, ps.path)
                                    .then(reload)
                                    .catch((e) => window.alert((e as Error).message));
                            }}
                        >
                            ✕
                        </button>
                    </div>
                    <div className="ps-constraints" onBlur={() => setTimeout(reload, 400)}>
                        {EDITABLE.map((f) => (
                            <label key={f.constraint} className="constraint-label">
                                <span>{f.constraint}</span>
                                <ConstraintInput shape={shapeIri} ps={ps} field={f} />
                            </label>
                        ))}
                    </div>
                </div>
            ))}
            <div className="value-row" style={{ marginTop: 8 }}>
                <input
                    placeholder="new property path (curie or IRI)"
                    value={newPath}
                    onChange={(e) => setNewPath(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addPath()}
                    style={{ flex: 1 }}
                />
                <button onClick={addPath} disabled={!newPath.trim()}>
                    + Property
                </button>
            </div>
        </div>
    );
}
