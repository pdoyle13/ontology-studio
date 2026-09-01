// Checkpoint backups + point-in-time restore.
//   checkpoint = full dump of every named graph (canonical N-Triples) +
//                manifest recording the Kafka journal offsets at that moment
//   restore(checkpoint, until?) = wipe graphs → load checkpoint → replay
//                journal events after the recorded offsets up to `until`
// Classic checkpoint + WAL, with Kafka as the WAL.

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { currentOffsets, readJournal } from './eventBus.mjs';

async function listGraphs(oxigraph) {
    const res = await fetch(`${oxigraph}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' },
        body: 'SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }',
    });
    if (!res.ok) throw new Error(`graph list ${res.status}`);
    return (await res.json()).results.bindings.map((b) => b.g.value);
}

async function dumpGraph(oxigraph, graph) {
    const res = await fetch(`${oxigraph}/store?graph=${encodeURIComponent(graph)}`, {
        headers: { Accept: 'application/n-triples' },
    });
    if (!res.ok) throw new Error(`dump ${graph}: ${res.status}`);
    return (await res.text())
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .sort()
        .join('\n');
}

const fileSlug = (iri) =>
    iri
        .replace(/^https?:\/\//, '')
        .replace(/[^\w.-]+/g, '-')
        .slice(0, 80);

export function createBackupEngine({ oxigraph, repoDir, log = console }) {
    const dir = join(repoDir, 'backups');
    mkdirSync(dir, { recursive: true });

    async function checkpoint(label = '') {
        const id = `cp-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        const cpDir = join(dir, id);
        mkdirSync(cpDir, { recursive: true });
        const graphs = await listGraphs(oxigraph);
        const files = {};
        let triples = 0;
        for (const g of graphs) {
            const nt = await dumpGraph(oxigraph, g);
            const f = `${fileSlug(g)}.nt`;
            writeFileSync(join(cpDir, f), nt + '\n');
            files[g] = f;
            triples += nt ? nt.split('\n').length : 0;
        }
        const offsets = await currentOffsets(log); // null when kafka is down — restore then has no replay
        const manifest = { id, at: new Date().toISOString(), label, graphs: files, triples, kafkaOffsets: offsets };
        writeFileSync(join(cpDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        log.log(
            `backup: checkpoint ${id} (${graphs.length} graphs, ${triples} triples${offsets ? ', journal offsets recorded' : ', NO journal offsets — kafka down'})`,
        );
        return manifest;
    }

    function listCheckpoints() {
        if (!existsSync(dir)) return [];
        return readdirSync(dir)
            .filter((d) => d.startsWith('cp-') && existsSync(join(dir, d, 'manifest.json')))
            .map((d) => JSON.parse(readFileSync(join(dir, d, 'manifest.json'), 'utf8')))
            .sort((a, b) => b.at.localeCompare(a.at));
    }

    async function applyReplayEvent(e) {
        const r = e.replay;
        if (!r || r.oversized) return 'skipped';
        if (r.kind === 'sparql-update') {
            const res = await fetch(`${oxigraph}/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/sparql-update' },
                body: r.body,
            });
            return res.ok ? 'applied' : 'failed';
        }
        if (r.kind === 'store-post' || r.kind === 'store-put') {
            const url = r.graph
                ? `${oxigraph}/store?graph=${encodeURIComponent(r.graph)}`
                : `${oxigraph}/store?default`;
            const res = await fetch(url, {
                method: r.kind === 'store-put' ? 'PUT' : 'POST',
                headers: { 'Content-Type': r.contentType ?? 'application/n-triples' },
                body: r.body,
            });
            return res.ok ? 'applied' : 'failed';
        }
        if (r.kind === 'store-delete' && r.graph) {
            await fetch(`${oxigraph}/store?graph=${encodeURIComponent(r.graph)}`, { method: 'DELETE' });
            return 'applied';
        }
        return 'skipped';
    }

    /** Point-in-time restore: checkpoint state + journal replay up to `until`. */
    async function restore({ checkpointId, until }) {
        const cps = listCheckpoints();
        const cp = cps.find((c) => c.id === checkpointId);
        if (!cp)
            throw new Error(
                `no such checkpoint: ${checkpointId}. Available: ${cps.map((c) => c.id).join(', ') || '(none)'}`,
            );
        const cpDir = join(dir, cp.id);

        // wipe current named graphs, then load the checkpoint
        const current = await listGraphs(oxigraph);
        for (const g of current) {
            await fetch(`${oxigraph}/store?graph=${encodeURIComponent(g)}`, { method: 'DELETE' });
        }
        let loaded = 0;
        for (const [g, f] of Object.entries(cp.graphs)) {
            const nt = readFileSync(join(cpDir, f), 'utf8');
            if (!nt.trim()) continue;
            const res = await fetch(`${oxigraph}/store?graph=${encodeURIComponent(g)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/n-triples' },
                body: nt,
            });
            if (!res.ok) throw new Error(`restore load ${g}: ${res.status}`);
            loaded++;
        }

        // replay the journal from the checkpoint's offsets up to `until`
        let replayed = 0;
        let skipped = 0;
        let failed = 0;
        let replayError = null;
        if (cp.kafkaOffsets && cp.kafkaOffsets.length > 0) {
            try {
                const events = await readJournal({ fromOffsets: cp.kafkaOffsets, until }, log);
                for (const e of events) {
                    const r = await applyReplayEvent(e);
                    if (r === 'applied') replayed++;
                    else if (r === 'failed') failed++;
                    else skipped++;
                }
            } catch (e) {
                // checkpoint state IS loaded — a replay failure degrades to snapshot-only restore
                replayError = String(e.message).slice(0, 200);
                log.warn(`backup: journal replay failed (${replayError}) — restored to checkpoint state only`);
            }
        } else {
            replayError = 'checkpoint has no journal offsets (kafka was down at checkpoint time)';
        }
        log.log(
            `backup: restored ${cp.id} (${loaded} graphs) + replayed ${replayed} events${until ? ` up to ${until}` : ''} (${skipped} skipped, ${failed} failed)`,
        );
        return {
            checkpoint: cp.id,
            graphsLoaded: loaded,
            replayed,
            skipped,
            failed,
            replayError,
            until: until ?? null,
        };
    }

    return { checkpoint, listCheckpoints, restore };
}
