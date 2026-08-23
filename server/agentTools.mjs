// Typed graph-editing tools for the modeling agent. Each tool is a specific
// action (create class, create property, link resources…) — the model never
// hand-writes update SPARQL. All writes are graph-scoped and built server-side.

const RDF_ = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const SH = 'http://www.w3.org/ns/shacl#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const DEFAULT_NS = 'https://studio.local/model#';

const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
const isIri = (s) => /^(https?|urn):/.test(String(s));

function ctx(oxigraph, graph) {
  const wrap = (t) => (graph ? `GRAPH <${graph}> { ${t} }` : t);
  return {
    wrap,
    async update(u) {
      const res = await fetch(`${oxigraph}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sparql-update' },
        body: u,
      });
      if (!res.ok) throw new Error(`update ${res.status}: ${(await res.text()).slice(0, 400)}`);
      return 'OK';
    },
    async query(q) {
      const url = new URL(`${oxigraph}/query`);
      if (graph) url.searchParams.set('default-graph-uri', graph);
      else url.searchParams.set('union-default-graph', '');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' },
        body: q,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`query ${res.status}: ${text.slice(0, 400)}`);
      return text.length > 15000 ? `${text.slice(0, 15000)}\n…(truncated)` : text;
    },
  };
}

/** Resolve an IRI: full IRI passes through; a bare name is minted in ns. */
function mint(ns, iriOrName) {
  const v = String(iriOrName).trim();
  return isIri(v) ? v : `${ns}${v.replace(/\s+/g, '')}`;
}

function termFor(value, { isIriValue, datatype, lang } = {}) {
  const v = String(value);
  if (isIriValue || isIri(v)) return `<${v}>`;
  if (lang) return `"${esc(v)}"@${lang}`;
  if (datatype) return `"${esc(v)}"^^<${datatype}>`;
  if (/^-?\d+$/.test(v)) return `"${esc(v)}"^^<${XSD}integer>`;
  if (/^-?\d*\.\d+$/.test(v)) return `"${esc(v)}"^^<${XSD}decimal>`;
  if (v === 'true' || v === 'false') return `"${v}"^^<${XSD}boolean>`;
  return `"${esc(v)}"`;
}

const str = { type: 'string' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };

/** Tool registry: JSON-schema defs + async executors. federation (optional):
 *  { readCatalog(), queryClass({classIri, columns, filters, limit}) } */
export function buildTools({ oxigraph, graph, namespace, federation, writePolicy, graphqlExec }) {
  const c = ctx(oxigraph, graph);
  // governance: route writes through the policy - stage into a proposal, or
  // refuse when the acting user lacks direct-write rights on this graph
  if (writePolicy) {
    const rawUpdate = c.update.bind(c);
    c.update = async (u) => {
      if (writePolicy.proposalId) {
        await writePolicy.stage(u);
        return 'STAGED into proposal ' + writePolicy.proposalId + ' (pending review - not yet applied)';
      }
      if (!writePolicy.canDirect) {
        throw new Error(
          "acting user '" + writePolicy.user + "' (" + writePolicy.role + ") may not write directly to this graph. " +
          'Create a proposal (POST /api/proposals) and rerun with it, or ask a steward/admin.'
        );
      }
      const out = await rawUpdate(u);
      writePolicy.journal?.(u);
      return out;
    };
  }
  const ns = namespace || DEFAULT_NS;
  const STUDIO_NS = 'https://studio.local/ns#';

  const defs = [
    {
      name: 'get_schema_overview',
      description:
        'Summarize the graph: classes with instance counts, node shapes with their target classes and property shapes, and the namespaces in use. Call this FIRST before modeling.',
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => {
        const classes = await c.query(
          `SELECT ?cls (COUNT(DISTINCT ?i) AS ?instances) WHERE { { ?cls a <${RDFS}Class> } UNION { ?i2 a ?cls } OPTIONAL { ?i a ?cls } FILTER(isIRI(?cls)) } GROUP BY ?cls ORDER BY DESC(?instances) LIMIT 60`
        );
        const shapes = await c.query(
          `SELECT ?shape ?target ?path ?datatype ?class ?minCount ?maxCount WHERE { ?shape <${SH}targetClass> ?target . ?shape <${SH}property> ?ps . ?ps <${SH}path> ?path . OPTIONAL { ?ps <${SH}datatype> ?datatype } OPTIONAL { ?ps <${SH}class> ?class } OPTIONAL { ?ps <${SH}minCount> ?minCount } OPTIONAL { ?ps <${SH}maxCount> ?maxCount } } ORDER BY ?shape LIMIT 200`
        );
        return JSON.stringify({ classes: JSON.parse(classes), shapes: JSON.parse(shapes) });
      },
    },
    {
      name: 'get_resource',
      description: 'Fetch all outgoing triples of a resource plus up to 50 incoming references.',
      parameters: { type: 'object', properties: { iri: str }, required: ['iri'] },
      run: async ({ iri }) => {
        const out = await c.query(`SELECT ?p ?o WHERE { <${iri}> ?p ?o } LIMIT 300`);
        const inc = await c.query(`SELECT ?s ?p WHERE { ?s ?p <${iri}> } LIMIT 50`);
        return JSON.stringify({ outgoing: JSON.parse(out), incoming: JSON.parse(inc) });
      },
    },
    {
      name: 'sparql_query',
      description:
        'Read-only SPARQL SELECT/ASK escape hatch for questions the other tools cannot answer. NEVER use for writes — use the typed action tools.',
      parameters: { type: 'object', properties: { query: str }, required: ['query'] },
      run: async ({ query }) => {
        if (!/^\s*(#.*\n|PREFIX[^\n]*\n)*\s*(SELECT|ASK)\b/i.test(query)) throw new Error('read-only: SELECT/ASK only');
        return c.query(query);
      },
    },
    {
      name: 'create_class',
      description: 'Create an rdfs:Class. name may be a bare name (minted in the working namespace) or a full IRI.',
      parameters: {
        type: 'object',
        properties: { name: str, label: str, subClassOf: str, comment: str },
        required: ['name', 'label'],
      },
      run: async ({ name, label, subClassOf, comment }) => {
        const iri = mint(ns, name);
        const lines = [
          `<${iri}> <${RDF_}type> <${RDFS}Class> .`,
          `<${iri}> <${RDFS}label> "${esc(label)}" .`,
          subClassOf ? `<${iri}> <${RDFS}subClassOf> <${mint(ns, subClassOf)}> .` : '',
          comment ? `<${iri}> <${RDFS}comment> "${esc(comment)}" .` : '',
        ].filter(Boolean);
        await c.update(`INSERT DATA { ${c.wrap(lines.join('\n'))} }`);
        return `created class <${iri}>`;
      },
    },
    {
      name: 'create_property',
      description:
        'Create an rdf:Property with optional domain and range. For object properties set rangeClass; for literals set rangeDatatype (an xsd IRI or local name like integer/string/date).',
      parameters: {
        type: 'object',
        properties: { name: str, label: str, domain: str, rangeClass: str, rangeDatatype: str, comment: str },
        required: ['name', 'label'],
      },
      run: async ({ name, label, domain, rangeClass, rangeDatatype, comment }) => {
        const iri = mint(ns, name);
        const dt = rangeDatatype ? (isIri(rangeDatatype) ? rangeDatatype : `${XSD}${rangeDatatype}`) : null;
        const lines = [
          `<${iri}> <${RDF_}type> <${RDF_}Property> .`,
          `<${iri}> <${RDFS}label> "${esc(label)}" .`,
          domain ? `<${iri}> <${RDFS}domain> <${mint(ns, domain)}> .` : '',
          rangeClass ? `<${iri}> <${RDFS}range> <${mint(ns, rangeClass)}> .` : '',
          dt ? `<${iri}> <${RDFS}range> <${dt}> .` : '',
          comment ? `<${iri}> <${RDFS}comment> "${esc(comment)}" .` : '',
        ].filter(Boolean);
        await c.update(`INSERT DATA { ${c.wrap(lines.join('\n'))} }`);
        return `created property <${iri}>`;
      },
    },
    {
      name: 'create_node_shape',
      description:
        'Create a sh:NodeShape targeting a class, with property shapes. Each property: path (property name or IRI), optional name/datatype (xsd local name)/classIri/minCount/maxCount/order.',
      parameters: {
        type: 'object',
        properties: {
          targetClass: str,
          properties: {
            type: 'array',
            items: {
              type: 'object',
              properties: { path: str, name: str, datatype: str, classIri: str, minCount: int, maxCount: int, order: int },
              required: ['path'],
            },
          },
        },
        required: ['targetClass', 'properties'],
      },
      run: async ({ targetClass, properties }) => {
        const cls = mint(ns, targetClass);
        const shape = `${cls}Shape`;
        const lines = [`<${shape}> <${RDF_}type> <${SH}NodeShape> .`, `<${shape}> <${SH}targetClass> <${cls}> .`];
        properties.forEach((p, i) => {
          const path = mint(ns, p.path);
          const psIri = `${shape}-p-${path.split(/[#/]/).pop()}`;
          lines.push(`<${shape}> <${SH}property> <${psIri}> .`);
          lines.push(`<${psIri}> <${SH}path> <${path}> .`);
          if (p.name) lines.push(`<${psIri}> <${SH}name> "${esc(p.name)}" .`);
          const dt = p.datatype ? (isIri(p.datatype) ? p.datatype : `${XSD}${p.datatype}`) : null;
          if (dt) lines.push(`<${psIri}> <${SH}datatype> <${dt}> .`);
          if (p.classIri) lines.push(`<${psIri}> <${SH}class> <${mint(ns, p.classIri)}> .`);
          if (p.minCount != null) lines.push(`<${psIri}> <${SH}minCount> "${p.minCount}"^^<${XSD}integer> .`);
          if (p.maxCount != null) lines.push(`<${psIri}> <${SH}maxCount> "${p.maxCount}"^^<${XSD}integer> .`);
          lines.push(`<${psIri}> <${SH}order> "${p.order ?? i + 1}"^^<${XSD}integer> .`);
        });
        await c.update(`INSERT DATA { ${c.wrap(lines.join('\n'))} }`);
        return `created shape <${shape}> with ${properties.length} property shapes`;
      },
    },
    {
      name: 'create_instance',
      description:
        'Create an instance of a class with a label and initial property values. Values that look like IRIs become object links; use datatype for typed literals.',
      parameters: {
        type: 'object',
        properties: {
          classIri: str,
          name: str,
          label: str,
          properties: {
            type: 'array',
            items: {
              type: 'object',
              properties: { predicate: str, value: str, isIriValue: bool, datatype: str, lang: str },
              required: ['predicate', 'value'],
            },
          },
        },
        required: ['classIri', 'name'],
      },
      run: async ({ classIri, name, label, properties = [] }) => {
        const iri = mint(ns, name);
        const lines = [`<${iri}> <${RDF_}type> <${mint(ns, classIri)}> .`];
        if (label) lines.push(`<${iri}> <${RDFS}label> "${esc(label)}" .`);
        for (const p of properties) {
          const dt = p.datatype ? (isIri(p.datatype) ? p.datatype : `${XSD}${p.datatype}`) : undefined;
          lines.push(`<${iri}> <${mint(ns, p.predicate)}> ${termFor(p.value, { ...p, datatype: dt })} .`);
        }
        await c.update(`INSERT DATA { ${c.wrap(lines.join('\n'))} }`);
        return `created instance <${iri}>`;
      },
    },
    {
      name: 'set_property_value',
      description: 'Add a property value on a resource (object link when the value is an IRI, literal otherwise).',
      parameters: {
        type: 'object',
        properties: { subject: str, predicate: str, value: str, isIriValue: bool, datatype: str, lang: str },
        required: ['subject', 'predicate', 'value'],
      },
      run: async ({ subject, predicate, value, isIriValue, datatype, lang }) => {
        const dt = datatype ? (isIri(datatype) ? datatype : `${XSD}${datatype}`) : undefined;
        await c.update(
          `INSERT DATA { ${c.wrap(`<${mint(ns, subject)}> <${mint(ns, predicate)}> ${termFor(value, { isIriValue, datatype: dt, lang })} .`)} }`
        );
        return 'value added';
      },
    },
    {
      name: 'remove_property_value',
      description: 'Remove a specific property value from a resource (matches literal text or IRI).',
      parameters: {
        type: 'object',
        properties: { subject: str, predicate: str, value: str, isIriValue: bool },
        required: ['subject', 'predicate', 'value'],
      },
      run: async ({ subject, predicate, value, isIriValue }) => {
        const t = isIriValue || isIri(value) ? `<${value}>` : null;
        const s = `<${mint(ns, subject)}>`;
        const p = `<${mint(ns, predicate)}>`;
        if (t) await c.update(`DELETE DATA { ${c.wrap(`${s} ${p} ${t} .`)} }`);
        else
          await c.update(
            `DELETE { ${c.wrap(`${s} ${p} ?o .`)} } WHERE { ${c.wrap(`${s} ${p} ?o . FILTER(isLiteral(?o) && STR(?o) = "${esc(value)}")`)} }`
          );
        return 'value removed';
      },
    },
    {
      name: 'link_resources',
      description: 'Create a single object-property edge between two existing resources.',
      parameters: { type: 'object', properties: { subject: str, predicate: str, object: str }, required: ['subject', 'predicate', 'object'] },
      run: async ({ subject, predicate, object }) => {
        await c.update(`INSERT DATA { ${c.wrap(`<${mint(ns, subject)}> <${mint(ns, predicate)}> <${mint(ns, object)}> .`)} }`);
        return 'linked';
      },
    },
    {
      name: 'declare_link',
      description:
        'FIELD-LEVEL CROSS-DATABASE CONNECTION: declare that two classes are related by matching key FIELDS (e.g. shipment order_ref = order order_number). Writes ONLY the meta-layer declaration — predicate with domain/range and the join key properties. NO instance edges are materialized; instance joins resolve live at query time from this declaration (virtual traversal, federation, lineage).',
      parameters: {
        type: 'object',
        properties: {
          subjectClass: str,
          sourceKeyProperty: str,
          targetClass: str,
          targetKeyProperty: str,
          predicate: str,
          predicateLabel: str,
        },
        required: ['subjectClass', 'sourceKeyProperty', 'targetClass', 'targetKeyProperty', 'predicate'],
      },
      run: async ({ subjectClass, sourceKeyProperty, targetClass, targetKeyProperty, predicate, predicateLabel }) => {
        const sc = mint(ns, subjectClass);
        const skp = mint(ns, sourceKeyProperty);
        const tc = mint(ns, targetClass);
        const tkp = mint(ns, targetKeyProperty);
        const pred = mint(ns, predicate);
        const decl = [
          `<${pred}> <${RDF_}type> <${RDF_}Property> .`,
          predicateLabel ? `<${pred}> <${RDFS}label> "${esc(predicateLabel)}" .` : '',
          `<${pred}> <${RDFS}domain> <${sc}> .`,
          `<${pred}> <${RDFS}range> <${tc}> .`,
          // the join spec IS the connection — everything downstream reads it
          `<${pred}> <${STUDIO_NS}sourceKeyProperty> <${skp}> .`,
          `<${pred}> <${STUDIO_NS}targetKeyProperty> <${tkp}> .`,
        ].filter(Boolean).join('\n');
        await c.update(`INSERT DATA { ${c.wrap(decl)} }`);
        return `declared field-level link <${pred}>: <${sc}>.<${skp}> = <${tc}>.<${tkp}> (no instance edges — resolved live)`;
      },
    },
    {
      name: 'delete_resource',
      description: 'Delete a resource: all its outgoing triples, and optionally all incoming references.',
      parameters: { type: 'object', properties: { iri: str, includeIncoming: bool }, required: ['iri'] },
      run: async ({ iri, includeIncoming }) => {
        const delOut = `DELETE WHERE { ${c.wrap(`<${iri}> ?p ?o .`)} }`;
        const delIn = `DELETE WHERE { ${c.wrap(`?s ?p <${iri}> .`)} }`;
        await c.update(includeIncoming ? `${delOut} ; ${delIn}` : delOut);
        return `deleted <${iri}>`;
      },
    },
  ];

  if (graphqlExec) {
    defs.push({
      name: 'graphql_query',
      description:
        'GRAPHQL OVER THE WHOLE ESTATE: execute a GraphQL query against the shape-derived schema (fetch the SDL first via {query:"{ __schema { queryType { fields { name } } } }"} introspection or ask for a specific type). Virtual classes resolve from live SQL, meta classes from the graph. Best for shaped multi-entity reads in one call; use query_source_data for filtered SQL.',
      parameters: {
        type: 'object',
        properties: { query: str, variables: { type: 'object' } },
        required: ['query'],
      },
      run: async ({ query, variables }) => {
        const r = await graphqlExec(query, variables);
        return JSON.stringify(r).slice(0, 20000);
      },
    });
  }

  if (federation) {
    defs.push(
      {
        name: 'get_data_catalog',
        description:
          'THE KNOWLEDGE-GRAPH-DERIVED DATA CATALOG: which classes live in which database (source, engine kind, table), their column↔property mappings, and the cross-database link predicates WITH their join key properties. Use this to plan which databases to query for live data. Everything here comes from the R2RML mappings graph and the ontology — nothing is hardcoded.',
        parameters: { type: 'object', properties: {}, required: [] },
        run: async () => {
          const catalog = await federation.readCatalog();
          // cross-class link predicates + their recorded join keys (written by link_by_key)
          const linksRaw = await c.query(
            `SELECT ?p ?dom ?rng ?sk ?tk WHERE {
  ?p <http://www.w3.org/2000/01/rdf-schema#domain> ?dom ;
     <http://www.w3.org/2000/01/rdf-schema#range> ?rng .
  OPTIONAL { ?p <${STUDIO_NS}sourceKeyProperty> ?sk }
  OPTIONAL { ?p <${STUDIO_NS}targetKeyProperty> ?tk }
  FILTER(isIRI(?rng) && !STRSTARTS(STR(?rng), "http://www.w3.org/2001/XMLSchema#"))
}`
          );
          const classIris = new Set(catalog.map((e) => e.classIri));
          const links = JSON.parse(linksRaw)
            .results.bindings.filter(
              (b) => classIris.has(b.dom?.value) && classIris.has(b.rng?.value)
            )
            .map((b) => ({
              property: b.p.value,
              from: b.dom.value,
              to: b.rng.value,
              sourceKeyProperty: b.sk?.value ?? null,
              targetKeyProperty: b.tk?.value ?? null,
            }));
          return JSON.stringify({ classes: catalog, links });
        },
      },
      {
        name: 'add_sql_source',
        description:
          'Attach a new SQL datasource to the studio: a SQLite file path or a PostgreSQL connection URL. After attaching, call translate_source to bring its schema into the graph as classes + shapes + mappings.',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['sqlite', 'postgres'] },
            target: { type: 'string', description: 'file path (sqlite) or postgres://user:pass@host:port/db' },
            id: { type: 'string', description: 'optional short identifier' },
          },
          required: ['kind', 'target'],
        },
        run: async ({ kind, target, id }) => {
          const s = await federation.addSource({ kind, target, id });
          return `attached source '${s.id}' (${s.kind}, ${s.tables} tables). Next: translate_source to model it in the graph.`;
        },
      },
      {
        name: 'translate_source',
        description:
          'Translate an attached datasource schema into the graph META layer: classes, properties, SHACL shapes (with label roles), and R2RML mappings. No instance data is copied — instances stay in the database and resolve live.',
        parameters: {
          type: 'object',
          properties: { sourceId: str, namespace: str },
          required: ['sourceId'],
        },
        run: async ({ sourceId, namespace }) => {
          const r = await federation.translateSource({ sourceId, graph, namespace });
          return `translated '${sourceId}': ${r.tables} tables → ${r.triples} schema triples + ${r.mappingTriples} R2RML mapping triples${graph ? ` in <${graph}>` : ''}. Classes are browsable now; consider discover_business_areas and declare_link for cross-database connections.`;
        },
      },
      {
        name: 'discover_business_areas',
        description:
          'Run FIBO-based business-area auto-discovery: matches every mapped data field across ALL attached databases against the shared FIBO vocabulary (Parties, Monetary Amounts, Contracts, Accounts, Identifiers, Dates…) and records the alignment in the graph. Afterwards get_data_catalog includes businessConcept/businessArea per field. Returns the discovery report.',
        parameters: { type: 'object', properties: {}, required: [] },
        run: async () => {
          const r = await federation.discover();
          return JSON.stringify({ fields: r.fields, areas: r.areas, sample: r.report.slice(0, 40) });
        },
      },
      {
        name: 'query_source_data',
        description:
          'FEDERATED LIVE QUERY: fetch fresh rows for a class directly from the database that owns it (resolved via the knowledge-graph catalog — you never name a database, the KG decides). filters: [{column, op (= != > < >= <= LIKE), value}]. Returns rows with minted IRIs plus which source/engine served them. Use the catalog first to learn classes, columns, and join keys, then chain queries across sources to answer cross-database questions.',
        parameters: {
          type: 'object',
          properties: {
            classIri: str,
            columns: { type: 'array', items: str },
            filters: {
              type: 'array',
              items: {
                type: 'object',
                properties: { column: str, op: str, value: { type: ['string', 'number'] } },
                required: ['column', 'value'],
              },
            },
            limit: int,
          },
          required: ['classIri'],
        },
        run: async ({ classIri, columns, filters, limit }) => {
          const r = await federation.queryClass({ classIri: mint(ns, classIri), columns, filters, limit });
          const rows = r.rows.slice(0, 100);
          return JSON.stringify({ ...r, rows, truncated: r.rows.length > 100 });
        },
      }
    );
  }

  return { defs, ns };
}
