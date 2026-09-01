// Help: the repo's markdown docs, bundled at build time and rendered in-app.
// The user guide opens first; persona guides and reference docs follow.
// The API reference (Swagger) is a live server page — linked, not bundled.

import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { marked } from 'marked';
import { Button } from '../ui/controls';

// Vite bundles every markdown doc as a raw string.
const RAW = import.meta.glob('../../docs/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<
    string,
    string
>;

const ORDER: { match: string; title: string }[] = [
    { match: 'docs/guide.md', title: 'User guide' },
    { match: 'docs/quickstart.md', title: 'Quickstart (run the stack)' },
    { match: 'docs/workspaces.md', title: 'Workspaces' },
    { match: 'personas/modeler.md', title: 'For modelers' },
    { match: 'personas/steward.md', title: 'For stewards' },
    { match: 'personas/explorer.md', title: 'For explorers' },
    { match: 'personas/developer.md', title: 'For developers' },
    { match: 'personas/admin.md', title: 'For admins' },
    { match: 'docs/governance.md', title: 'Governance model' },
    { match: 'docs/architecture.md', title: 'Architecture' },
    { match: 'docs/security.md', title: 'Security & hardening' },
];

function docList(): { title: string; body: string }[] {
    const entries = Object.entries(RAW);
    const out: { title: string; body: string }[] = [];
    for (const { match, title } of ORDER) {
        const hit = entries.find(([path]) => path.endsWith(match));
        if (hit) out.push({ title, body: hit[1] });
    }
    return out;
}

export const useHelp = create<{ open: boolean }>(() => ({ open: false }));
export const openHelp = () => useHelp.setState({ open: true });

export function HelpDialog() {
    const open = useHelp((s) => s.open);
    const docs = useMemo(docList, []);
    const [active, setActive] = useState(0);
    const html = useMemo(
        () => (docs[active] ? (marked.parse(docs[active].body, { async: false }) as string) : ''),
        [docs, active],
    );

    if (!open) return null;
    const close = () => useHelp.setState({ open: false });

    return (
        <div className="modal-overlay" onClick={close}>
            <div className="modal help-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="modal-title">Help</div>
                <div className="help-body">
                    <nav className="help-nav">
                        {docs.map((d, i) => (
                            <button
                                key={d.title}
                                className={`help-nav-item ${i === active ? 'active' : ''}`}
                                onClick={() => setActive(i)}
                            >
                                {d.title}
                            </button>
                        ))}
                        <a className="help-nav-item" href="/api/docs" target="_blank" rel="noreferrer">
                            API reference ↗
                        </a>
                    </nav>
                    {/* SECURITY (P1.7): the only input is repo markdown bundled at build
              time via import.meta.glob (RAW) — never props, fetch, or user
              input. If that ever changes, sanitize before rendering. */}
                    <article className="help-md" dangerouslySetInnerHTML={{ __html: html }} />
                </div>
                <div className="modal-row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
                    <Button onClick={close}>Close</Button>
                </div>
            </div>
        </div>
    );
}
