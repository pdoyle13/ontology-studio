import { useWorkspace, WORKSPACES, type Workspace } from '../state/workspace';
import { Button, Ghost, Input, Select } from '../ui/controls';
import { useGraph as useGraphForToast } from '../state/graph';
import { useState } from 'react';
import { useConnection } from '../state/connection';
import { oxigraphEndpoint } from '../rdf/sparqlClient';
import { ImportExportDialog } from './ImportExport';
import { openSettings } from './SettingsDialog';
import { openHelp } from './HelpDialog';
import { useUi } from '../state/ui';
import { useCollab } from '../state/collab';
import { useIdentity } from '../state/identity';

export function ConnectionBar() {
    const showImport = useUi((s) => s.importExportOpen);
    const setShowImport = useUi((s) => s.setImportExportOpen);
    const { endpoints, activeId, status, statusMessage, graphs, activeGraph, connect, addEndpoint, setActiveGraph } =
        useConnection();
    const peers = useCollab((s) => s.peers);
    const identity = useIdentity();
    const [adding, setAdding] = useState(false);
    const [kind, setKind] = useState<'oxigraph' | 'generic'>('oxigraph');
    const [url, setUrl] = useState('http://localhost:7880');
    const [updateUrl, setUpdateUrl] = useState('');
    const [name, setName] = useState('');

    const add = () => {
        if (!url.trim()) return;
        if (kind === 'oxigraph') {
            addEndpoint(oxigraphEndpoint(url.trim(), name || url.trim()));
        } else {
            const q = url.trim();
            addEndpoint({
                id: q,
                name: name || q,
                queryUrl: q,
                updateUrl: updateUrl.trim() || undefined,
            });
        }
        setAdding(false);
        setName('');
        setUpdateUrl('');
    };

    const dotClass = { connected: 'dot ok', connecting: 'dot busy', error: 'dot err', disconnected: 'dot' }[status];

    return (
        <header className="connection-bar">
            <span className="brand">Ontology Studio</span>
            <Toasts />
            <Select
                className="workspace-switch"
                title="Workspace — a lens for your role, not a separate product"
                value={useWorkspace((s) => s.workspace)}
                onChange={(e) => useWorkspace.getState().setWorkspace(e.target.value as Workspace)}
            >
                {Object.values(WORKSPACES).map((w) => (
                    <option key={w.id} value={w.id} title={w.hint}>
                        {w.label}
                    </option>
                ))}
            </Select>
            {peers > 1 && (
                <span className="presence" title={`${peers} people are in this workspace right now`}>
                    {peers} online
                </span>
            )}
            <span className={dotClass} title={statusMessage} />
            <Select
                value={activeId ?? ''}
                onChange={(e) => e.target.value && connect(e.target.value)}
                className="ep-select"
            >
                <option value="" disabled>
                    Select endpoint…
                </option>
                {endpoints.map((ep) => (
                    <option key={ep.id} value={ep.id}>
                        {ep.name}
                    </option>
                ))}
            </Select>
            {status === 'connected' && (
                <Select
                    value={activeGraph ?? ''}
                    onChange={(e) => setActiveGraph(e.target.value || null)}
                    className="graph-select"
                    title="Named graph scope"
                >
                    <option value="">default graph</option>
                    {graphs.map((g) => (
                        <option key={g.graph} value={g.graph}>
                            {g.graph} ({g.triples.toLocaleString()})
                        </option>
                    ))}
                </Select>
            )}
            {status === 'error' && <span className="status-msg err-text">{statusMessage}</span>}
            {status === 'connected' && <Ghost onClick={() => setShowImport(true)}>Import / Export</Ghost>}
            {status === 'connected' && (
                <Ghost title="Settings" onClick={openSettings}>
                    ⚙
                </Ghost>
            )}
            <Ghost title="Help — how to use Ontology Studio" onClick={openHelp}>
                ?
            </Ghost>
            <Select
                className="acting-as"
                value={identity.actingUser}
                onChange={(e) => {
                    identity.setActingUser(e.target.value);
                    location.reload();
                }}
                title="Acting as (governance identity)"
            >
                {(identity.users.length ? identity.users : [{ name: identity.actingUser, role: '?', governs: [] }]).map(
                    (u) => (
                        <option key={u.name} value={u.name}>
                            {u.name} ({u.role})
                        </option>
                    ),
                )}
            </Select>
            <Ghost onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : '+ Endpoint'}</Ghost>
            {showImport && <ImportExportDialog onClose={() => setShowImport(false)} />}
            {adding && (
                <span className="add-form">
                    <Select value={kind} onChange={(e) => setKind(e.target.value as 'oxigraph' | 'generic')}>
                        <option value="oxigraph">Oxigraph</option>
                        <option value="generic">Generic SPARQL</option>
                    </Select>
                    <Input
                        placeholder="Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        style={{ width: 120 }}
                    />
                    <Input
                        placeholder={kind === 'oxigraph' ? 'Oxigraph base URL' : 'Query endpoint URL'}
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        style={{ width: 260 }}
                    />
                    {kind === 'generic' && (
                        <Input
                            placeholder="Update URL (blank = read-only)"
                            value={updateUrl}
                            onChange={(e) => setUpdateUrl(e.target.value)}
                            style={{ width: 220 }}
                        />
                    )}
                    <Button onClick={add}>Add</Button>
                    {kind === 'generic' && (
                        <Ghost
                            title="Preset: Wikidata (read-only)"
                            onClick={() => {
                                setName('Wikidata (read-only)');
                                setUrl('https://query.wikidata.org/sparql');
                                setUpdateUrl('');
                            }}
                        >
                            Wikidata
                        </Ghost>
                    )}
                </span>
            )}
        </header>
    );
}

function Toasts() {
    const toasts = useCollab((s) => s.toasts);
    if (toasts.length === 0) return null;
    return (
        <div className="toast-stack">
            {toasts.map((t) => (
                <div
                    key={t.id}
                    className="toast"
                    onClick={() => t.iri && useGraphForToast.getState().selectResource(t.iri)}
                >
                    {t.text}
                </div>
            ))}
        </div>
    );
}
