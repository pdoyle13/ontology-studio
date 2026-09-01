// Provenance for virtual resources: which source and R2RML mapping produce
// these facts. Facts for a virtual instance are never stored — they resolve
// live through the mapping, so the mapping IS the provenance record.

import { useEffect, useState } from 'react';
import { useConnection } from '../state/connection';
import { select } from '../rdf/sparqlClient';
import { openMappingEditor } from './MappingEditor';

const RR = 'http://www.w3.org/ns/r2rml#';
const PROV = 'http://www.w3.org/ns/prov#';
const G = 'https://studio.local/graphs/mappings';

export function ProvenanceBlock({ sourceId, table }: { sourceId: string; table: string }) {
    const conn = useConnection();
    const [tm, setTm] = useState<string | null>(null);
    const [derivedFrom, setDerivedFrom] = useState<string | null>(null);

    useEffect(() => {
        const ep = conn.active();
        if (!ep) return;
        let cancelled = false;
        select(
            ep,
            `SELECT ?tm ?src WHERE { GRAPH <${G}> {
  ?tm <${RR}logicalTable>/<${RR}tableName> "${table.replace(/"/g, '\\"')}" .
  OPTIONAL { ?tm <${PROV}wasDerivedFrom> ?src }
} } LIMIT 1`,
        )
            .then((r) => {
                if (cancelled) return;
                setTm(r.bindings[0]?.tm?.value ?? null);
                setDerivedFrom(r.bindings[0]?.src?.value ?? null);
            })
            .catch(() => !cancelled && setTm(null));
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conn.activeId, sourceId, table]);

    return (
        <div className="prov-block">
            <div className="panel-title" style={{ marginTop: 8 }}>
                Provenance
            </div>
            <div className="term-meta prov-chain">
                <span title="Owning database">{sourceId}</span>
                {' → '}
                <span title="Source table" className="term-literal">
                    {table}
                </span>
                {' → '}
                {tm ? (
                    <>
                        <span title={tm}>R2RML mapping</span>{' '}
                        <button className="micro" title="Open the mapping editor" onClick={() => openMappingEditor(tm)}>
                            ✎
                        </button>
                    </>
                ) : (
                    <span>no mapping record</span>
                )}
            </div>
            {derivedFrom && (
                <div className="term-meta" title={derivedFrom}>
                    prov:wasDerivedFrom {derivedFrom.split(/[#/]/).pop()}
                </div>
            )}
            <div className="term-meta">
                Facts resolve live through the mapping at query time — nothing is copied into the graph.
            </div>
        </div>
    );
}
