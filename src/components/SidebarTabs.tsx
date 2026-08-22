import { useEffect, useState } from 'react';
import { ClassTree } from './ClassTree';
import { useConnection } from '../state/connection';
import { useGraph } from '../state/graph';
import { useValidation } from '../state/validation';
import { listNodeShapes } from '../rdf/shacl';

function ShapesList() {
  const conn = useConnection();
  const { prefixes, selectResource, selected } = useGraph();
  const [shapes, setShapes] = useState<{ iri: string; targetClass: string | null; propertyCount: number }[] | null>(null);

  useEffect(() => {
    const ep = conn.active();
    if (!ep) return;
    let cancelled = false;
    listNodeShapes(ep, conn.activeGraph).then((s) => !cancelled && setShapes(s)).catch(() => !cancelled && setShapes([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.activeId, conn.activeGraph]);

  if (!shapes) return <div className="tree-loading">loading shapes…</div>;
  if (shapes.length === 0) return <div className="placeholder">No node shapes in this scope</div>;
  return (
    <ul className="instance-list" style={{ marginLeft: 0, borderLeft: 'none' }}>
      {shapes.map((s) => (
        <li
          key={s.iri}
          className={selected === s.iri ? 'selected' : ''}
          title={s.iri}
          onClick={() => selectResource(s.iri)}
        >
          {prefixes.shrink(s.iri)}
          <span className="count" style={{ marginLeft: 6 }}>
            {s.targetClass ? `→ ${prefixes.shrink(s.targetClass)}` : ''} · {s.propertyCount} props
          </span>
        </li>
      ))}
    </ul>
  );
}

function IssuesList() {
  const { violations, running, error, lastRun, validate } = useValidation();
  const { prefixes, selectResource } = useGraph();

  return (
    <div>
      <button onClick={validate} disabled={running} style={{ width: '100%', marginBottom: 8 }}>
        {running ? 'Validating…' : 'Run SHACL validation'}
      </button>
      {error && <div className="err-text">{error}</div>}
      {lastRun !== null && !error && (
        <div className="term-meta" style={{ marginBottom: 6 }}>
          {violations.length === 0
            ? `✓ conforms (${lastRun.toLocaleString()} triples checked)`
            : `${violations.length} result(s) over ${lastRun.toLocaleString()} triples`}
        </div>
      )}
      <ul className="issue-list">
        {violations.map((v, i) => (
          <li key={i} className={`issue sev-${v.severity.toLowerCase()}`} onClick={() => selectResource(v.focusNode)}>
            <div className="issue-node" title={v.focusNode}>
              {prefixes.shrink(v.focusNode)}
              {v.path && <span className="term-meta"> · {prefixes.shrink(v.path)}</span>}
            </div>
            <div className="issue-msg">{v.message}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Tab = 'classes' | 'shapes' | 'issues';

export function SidebarTabs() {
  const [tab, setTab] = useState<Tab>('classes');
  const count = useValidation((s) => s.violations.length);

  return (
    <div className="sidebar-tabs-wrap">
      <div className="tab-row">
        {(['classes', 'shapes', 'issues'] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'classes' ? 'Classes' : t === 'shapes' ? 'Shapes' : `Issues${count ? ` (${count})` : ''}`}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === 'classes' && <ClassTree />}
        {tab === 'shapes' && <ShapesList />}
        {tab === 'issues' && <IssuesList />}
      </div>
    </div>
  );
}
