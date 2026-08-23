// Search service: crawls the whole estate into the embedded index — meta layer
// (classes, properties, shapes, SKOS concepts/schemes) and live rows from every
// attached database (text columns, capped per class). Rebuilds are debounced on
// graph invalidation. With SEARCH_URL set, the same docs are bulk-pushed to a
// real Elasticsearch/OpenSearch cluster and _search is proxied there instead.

import { SearchIndex, search } from './searchIndex.mjs';
import { sparql } from '../core/meta.mjs';
import { readLabelProps } from '../semantic/virtual.mjs';

const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const ROW_CAP = 2000; // per virtual class

export function createSearchService({ oxigraph, federation, drivers, remoteUrl = process.env.SEARCH_URL || null }) {
  const index = new SearchIndex();
  let building = null;
  let dirty = true;
  let lastBuild = null;

  async function crawlMeta() {
    const docs = [];
    const rows = await sparql(
      oxigraph,
      `SELECT DISTINCT ?s ?type ?label ?extra WHERE {
        { ?s a <http://www.w3.org/2000/01/rdf-schema#Class> . BIND("class" AS ?type)
          OPTIONAL { ?s <http://www.w3.org/2000/01/rdf-schema#label> ?label } }
        UNION
        { ?s a <http://www.w3.org/ns/shacl#NodeShape> . BIND("shape" AS ?type)
          OPTIONAL { ?s <http://www.w3.org/2000/01/rdf-schema#label> ?label } }
        UNION
        { ?s a <${SKOS}Concept> . BIND("concept" AS ?type)
          OPTIONAL { ?s <${SKOS}prefLabel> ?label }
          OPTIONAL { ?s <${SKOS}definition> ?extra } }
        UNION
        { ?s a <${SKOS}ConceptScheme> . BIND("scheme" AS ?type)
          OPTIONAL { ?s <${SKOS}prefLabel> ?label } }
        UNION
        { ?s <http://www.w3.org/2000/01/rdf-schema#label> ?label ; a ?anyT . BIND("instance" AS ?type)
          FILTER(?anyT != <http://www.w3.org/2000/01/rdf-schema#Class> && ?anyT != <http://www.w3.org/ns/shacl#NodeShape>) }
        FILTER(isIRI(?s))
      }`
    );
    const byIri = new Map();
    for (const b of rows) {
      const iri = b.s.value;
      const cur = byIri.get(iri) ?? { iri, type: b.type.value, labels: new Set(), extras: new Set() };
      if (b.label) cur.labels.add(b.label.value);
      if (b.extra) cur.extras.add(b.extra.value);
      byIri.set(iri, cur);
    }
    // SKOS altLabels enrich concept docs
    const alts = await sparql(oxigraph, `SELECT ?s ?alt WHERE { ?s <${SKOS}altLabel> ?alt }`);
    for (const b of alts) byIri.get(b.s.value)?.extras.add(b.alt.value);
    for (const d of byIri.values()) {
      const label = [...d.labels][0] ?? d.iri.split(/[#/]/).pop();
      docs.push({
        id: d.iri,
        source: { iri: d.iri, kind: 'model', type: d.type, label },
        fields: { label, text: [...d.labels, ...d.extras].join(' ') },
      });
    }
    return docs;
  }

  async function crawlData() {
    if (!federation || !drivers) return [];
    const docs = [];
    const [catalog, labelProps] = await Promise.all([
      federation.readCatalog(),
      readLabelProps(oxigraph).catch(() => new Set()),
    ]);
    for (const entry of catalog) {
      const driver = drivers.get(entry.sourceId);
      if (!driver) continue;
      try {
        const cols = entry.columns.map((c) => c.column);
        const sql = `SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${entry.table}" LIMIT ${ROW_CAP}`;
        const rows = await driver.query(sql);
        const labelCol = entry.columns.find((c) => labelProps.has(c.property))?.column ?? null;
        for (const r of rows) {
          const textParts = cols.map((c) => r[c]).filter((v) => typeof v === 'string');
          const iri = mintFromTemplate(entry, r);
          if (!iri) continue;
          docs.push({
            id: iri,
            source: {
              iri,
              kind: 'data',
              type: 'row',
              label: (labelCol && r[labelCol] != null ? String(r[labelCol]) : null) ?? textParts[0] ?? iri.split('/').pop(),
              classIri: entry.classIri,
              sourceId: entry.sourceId,
            },
            fields: { label: textParts.slice(0, 2).join(' '), text: textParts.join(' ') },
          });
        }
      } catch {
        /* a downed source never fails the whole build */
      }
    }
    return docs;
  }

  function mintFromTemplate(entry, row) {
    try {
      return entry.subjectTemplate.replace(/\{([^}]+)\}/g, (_, col) => encodeURIComponent(String(row[col] ?? '')));
    } catch {
      return null;
    }
  }

  async function pushRemote(docs) {
    const lines = [];
    for (const d of docs) {
      lines.push(JSON.stringify({ index: { _index: 'studio', _id: d.id } }));
      lines.push(JSON.stringify({ ...d.source, label_text: d.fields.label, full_text: d.fields.text }));
    }
    await fetch(`${remoteUrl}/_bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body: lines.join('\n') + '\n',
    });
  }

  async function rebuild() {
    if (building) return building;
    building = (async () => {
      const [meta, data] = await Promise.all([crawlMeta(), crawlData()]);
      index.clear();
      for (const d of [...meta, ...data]) index.add(d.id, d.source, d.fields);
      if (remoteUrl) await pushRemote([...meta, ...data]).catch(() => {});
      dirty = false;
      lastBuild = { at: new Date().toISOString(), docs: index.size, meta: meta.length, data: data.length };
      await checkWatches();
      return lastBuild;
    })().finally(() => {
      building = null;
    });
    return building;
  }

  async function ensure() {
    if (dirty || index.size === 0) await rebuild();
  }

  let debounce = null;
  function markDirty() {
    dirty = true;
    clearTimeout(debounce);
    debounce = setTimeout(() => rebuild().catch(() => {}), 4000);
  }

  async function doSearch(body) {
    if (remoteUrl) {
      const res = await fetch(`${remoteUrl}/studio/_search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.json();
    }
    await ensure();
    return search(index, body);
  }

  /** Omnibox search: hits with highlights + facets, optionally filtered. */
  async function quick(q, { size = 24, kind = null, sourceId = null } = {}) {
    const must = [{ multi_match: { query: q, fields: ['label^3', 'text'] } }];
    const filter = [];
    if (kind) filter.push({ term: { kind } });
    if (sourceId) filter.push({ term: { sourceId } });
    const result = await doSearch({
      query: filter.length ? { bool: { must, filter } } : must[0],
      size,
      highlight: {},
      aggs: { byKind: { terms: { field: 'kind' } }, bySource: { terms: { field: 'sourceId' } }, byType: { terms: { field: 'type' } } },
    });
    return {
      hits: (result.hits?.hits ?? []).map((h) => ({ ...h._source, _highlight: h.highlight?.text?.[0] ?? null })),
      facets: result.aggregations ?? {},
      total: result.hits?.total?.value ?? 0,
    };
  }

  // ---- watches: saved searches that notify when NEW results appear ----
  const watches = new Map(); // id -> {id, query, user, lastIds: Set|null}
  let onWatchHit = null;
  const setWatchListener = (fn) => {
    onWatchHit = fn;
  };
  const addWatch = ({ id, query, user }) => {
    watches.set(id, { id, query, user, lastIds: null });
    return { id, query, user };
  };
  const removeWatch = (id) => watches.delete(id);
  const listWatches = () => [...watches.values()].map(({ id, query, user }) => ({ id, query, user }));

  async function checkWatches() {
    for (const w of watches.values()) {
      try {
        const r = await doSearch({ query: { multi_match: { query: w.query, fields: ['label^3', 'text'] } }, size: 100 });
        const ids = new Set((r.hits?.hits ?? []).map((h) => h._id));
        if (w.lastIds !== null) {
          const fresh = [...ids].filter((id) => !w.lastIds.has(id));
          if (fresh.length && onWatchHit) {
            onWatchHit({
              watchId: w.id,
              query: w.query,
              user: w.user,
              newHits: fresh.slice(0, 10).map((id) => index.docs.get(id)?.source ?? { iri: id }),
            });
          }
        }
        w.lastIds = ids;
      } catch {
        /* watch check never breaks a rebuild */
      }
    }
  }

  return {
    index,
    rebuild,
    ensure,
    markDirty,
    search: doSearch,
    quick,
    addWatch,
    removeWatch,
    listWatches,
    setWatchListener,
    stats: () => ({ docs: index.size, lastBuild, remote: !!remoteUrl, watches: watches.size }),
  };
}
