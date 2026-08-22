// Client side of the virtual instance layer: instance data is never in the
// store — these endpoints resolve it live from the owning SQL databases,
// planned from the graph's meta layer.

export interface VirtualClass {
  classIri: string;
  sourceId: string;
  table: string;
  rowCount: number;
  businessArea: string | null;
}

let memo: { at: number; classes: VirtualClass[] } | null = null;

export async function virtualClasses(): Promise<VirtualClass[]> {
  if (memo && Date.now() - memo.at < 60_000) return memo.classes;
  try {
    const res = await fetch('/api/virtual/classes');
    if (!res.ok) return memo?.classes ?? [];
    memo = { at: Date.now(), classes: await res.json() };
    return memo.classes;
  } catch {
    return memo?.classes ?? [];
  }
}

export function invalidateVirtualMemo() {
  memo = null;
}

export async function isVirtualClass(classIri: string): Promise<boolean> {
  return (await virtualClasses()).some((c) => c.classIri === classIri);
}

/** Does this IRI look like a virtual instance (classIri + '/key')? */
export async function matchVirtualIri(iri: string): Promise<boolean> {
  const classes = await virtualClasses();
  return classes.some((c) => iri.startsWith(`${c.classIri}/`));
}

export async function fetchVirtualInstances(
  classIri: string,
  search = '',
  limit = 200
): Promise<{ iri: string; label: string | null }[]> {
  const res = await fetch('/api/virtual/instances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ classIri, search, limit }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status}`);
  return res.json();
}

export interface VirtualDescription {
  iri: string;
  missing?: boolean;
  label: string | null;
  types: string[];
  outgoing: { predicate: string; object: { type: 'uri' | 'literal'; value: string; datatype?: string; label?: string } }[];
  incoming: { subject: string; subjectLabel: string | null; predicate: string }[];
  incomingTotal: number;
  virtual: { sourceId: string; table: string };
}

export async function fetchVirtualDescribe(iri: string): Promise<VirtualDescription | null> {
  const res = await fetch('/api/virtual/describe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ iri }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status}`);
  return res.json();
}
