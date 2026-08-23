// Meta-layer-as-code: every write debounces into a snapshot of each named
// graph as CANONICAL (sorted) N-Triples under graph/, then auto-commits the
// changed files. The ontology gets git history, diffs, review, and rollback —
// ontology versioning through plain version control.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const DEBOUNCE_MS = 5000;

const slug = (iri) =>
  iri.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

async function listGraphs(oxigraph) {
  const res = await fetch(`${oxigraph}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' },
    body: 'SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }',
  });
  if (!res.ok) throw new Error(`graph list ${res.status}`);
  return (await res.json()).results.bindings.map((b) => b.g.value);
}

async function exportGraph(oxigraph, graph) {
  const res = await fetch(`${oxigraph}/store?graph=${encodeURIComponent(graph)}`, {
    headers: { Accept: 'application/n-triples' },
  });
  if (!res.ok) throw new Error(`export ${graph}: ${res.status}`);
  const nt = await res.text();
  // canonical: sorted, trimmed lines → stable diffs
  return nt.split('\n').map((l) => l.trim()).filter(Boolean).sort().join('\n') + '\n';
}

export function createSnapshotter({ oxigraph, repoDir, autoCommit = true, log = console }) {
  const dir = join(repoDir, 'graph');
  mkdirSync(dir, { recursive: true });
  let timer = null;
  let running = false;
  let rerun = false;

  async function snapshot() {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      const graphs = await listGraphs(oxigraph);
      const changed = [];
      for (const g of graphs) {
        const file = join(dir, `${slug(g)}.nt`);
        const nt = `# graph: ${g}\n${await exportGraph(oxigraph, g)}`;
        const prev = existsSync(file) ? readFileSync(file, 'utf8') : null;
        if (prev !== nt) {
          writeFileSync(file, nt);
          changed.push(`graph/${slug(g)}.nt`);
        }
      }
      if (changed.length && autoCommit) {
        try {
          // another commit may hold index.lock (manual commits race the snapshotter)
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              execFileSync('git', ['add', ...changed], { cwd: repoDir });
              break;
            } catch (err) {
              if (attempt === 2 || !String(err.message).includes('index.lock')) throw err;
              await new Promise((r) => setTimeout(r, 700));
            }
          }
          const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repoDir }).toString().trim();
          if (staged) {
            execFileSync(
              'git',
              ['commit', '-m', `graph-snapshot: ${changed.map((c) => c.replace('graph/', '').replace('.nt', '')).join(', ')}`, '--only', ...changed],
              { cwd: repoDir }
            );
            log.log(`graph-as-code: committed ${changed.length} graph snapshot(s)`);
          }
        } catch (e) {
          log.warn(`graph-as-code commit failed (snapshots written): ${String(e.message).slice(0, 200)}`);
        }
      } else if (changed.length) {
        log.log(`graph-as-code: wrote ${changed.length} snapshot(s)`);
      }
    } catch (e) {
      log.warn(`graph-as-code snapshot failed: ${String(e.message).slice(0, 200)}`);
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        schedule();
      }
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(snapshot, DEBOUNCE_MS);
  }

  return { schedule, snapshotNow: snapshot };
}
