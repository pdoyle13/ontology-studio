import { useEffect, useState } from 'react';
import { useGraph } from '../state/graph';
import { useConnection } from '../state/connection';
import { fetchInstances, searchResources, type InstanceInfo } from '../rdf/queries';
import { localName } from '../rdf/prefixes';

function InstanceList({ classIri }: { classIri: string }) {
  const conn = useConnection();
  const { prefixes, selected, selectResource } = useGraph();
  const [instances, setInstances] = useState<InstanceInfo[] | null>(null);

  useEffect(() => {
    const ep = conn.active();
    if (!ep) return;
    let cancelled = false;
    fetchInstances(ep, conn.activeGraph, classIri).then((r) => {
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
      {instances.map((i) => (
        <li
          key={i.iri}
          className={selected === i.iri ? 'selected' : ''}
          title={i.iri}
          onClick={() => selectResource(i.iri)}
        >
          {i.label ?? prefixes.shrink(i.iri) ?? localName(i.iri)}
        </li>
      ))}
      {instances.length === 0 && <li className="tree-loading">no instances</li>}
    </ul>
  );
}

export function ClassTree() {
  const conn = useConnection();
  const { classes, classesLoading, prefixes, selectResource, selected, loadClasses } = useGraph();
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
      searchResources(ep, conn.activeGraph, search.trim()).then(setResults).catch(() => setResults([]));
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
              onClick={() => selectResource(r.iri)}
            >
              {r.label ?? prefixes.shrink(r.iri)}
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
                    onClick={(e) => {
                      e.stopPropagation();
                      selectResource(c.iri);
                    }}
                  >
                    {c.label ?? prefixes.shrink(c.iri)}
                  </span>
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
