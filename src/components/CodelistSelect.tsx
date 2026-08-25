// Select whose options are the ACTIVE (non-deprecated) codes of a concept
// scheme — reference data resolved live, never frozen into the shape.

import { useEffect, useState } from 'react';
import { useConnection } from '../state/connection';
import { fetchActiveCodes } from '../rdf/skos';

export function CodelistSelect({
  scheme,
  value,
  onChange,
}: {
  scheme: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const conn = useConnection();
  const [codes, setCodes] = useState<{ iri: string; label: string }[] | null>(null);

  useEffect(() => {
    const ep = conn.active();
    if (!ep) return;
    let cancelled = false;
    fetchActiveCodes(ep, scheme).then((c) => !cancelled && setCodes(c)).catch(() => !cancelled && setCodes([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.activeId, scheme]);

  return (
    <select className="codelist-select" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%' }}>
      <option value="">—</option>
      {/* a stored value whose code was later deprecated still displays */}
      {value && codes && !codes.some((c) => c.label === value) && <option value={value}>{value} (deprecated)</option>}
      {(codes ?? []).map((c) => (
        <option key={c.iri} value={c.label}>{c.label}</option>
      ))}
    </select>
  );
}
