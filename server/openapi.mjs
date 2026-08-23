// OpenAPI 3.1 spec for the studio-server API. Served at /api/openapi.json;
// interactive docs at /api/docs (Swagger UI). Agents should read this first.

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (schema, required = true) => ({ required, content: { 'application/json': { schema } } });
const jsonRes = (schema, description = 'OK') => ({ description, content: { 'application/json': { schema } } });

export function buildSpec() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Ontology Studio API',
      version: '1.0.0',
      description:
        'Virtual semantic layer over SQL estates. The graph (Oxigraph) holds the META layer only — ontology, SHACL shapes, R2RML mappings, field-level cross-database links, FIBO business alignment. Instance data stays in the SQL sources and is resolved live: browsing via the virtual layer, cross-database questions via KG-planned federation, authoring via the Grok agent with typed tools.',
    },
    servers: [{ url: '/' }],
    tags: [
      { name: 'sparql', description: 'Caching SPARQL passthrough to Oxigraph (meta layer)' },
      { name: 'sources', description: 'SQL datasources: attach, introspect, translate, query' },
      { name: 'virtual', description: 'Virtual instance layer — live rows, no materialization' },
      { name: 'federation', description: 'KG-planned cross-database data access' },
      { name: 'discovery', description: 'FIBO business-area auto-discovery' },
      { name: 'agent', description: 'Conversational modeling + data agent (Grok)' },
      { name: 'ops', description: 'Health and cache operations' },
    ],
    paths: {
      '/db/query': {
        post: {
          tags: ['sparql'],
          summary: 'SPARQL query (cached)',
          description:
            'Body: SPARQL query text (Content-Type: application/sparql-query). `?default-graph-uri=` scopes to one named graph and scopes the cache tag; `?union-default-graph` queries all graphs. Response carries `X-Cache: HIT-MEM | HIT-DISK | MISS`.',
          requestBody: { required: true, content: { 'application/sparql-query': { schema: { type: 'string' } } } },
          responses: { 200: { description: 'SPARQL results (JSON or Turtle per Accept header)' } },
        },
      },
      '/db/update': {
        post: {
          tags: ['sparql'],
          summary: 'SPARQL update (invalidates caches, tag-scoped)',
          description: 'Graphs named via `GRAPH <iri>` in the update body scope the cache invalidation to those graphs.',
          requestBody: { required: true, content: { 'application/sparql-update': { schema: { type: 'string' } } } },
          responses: { 204: { description: 'Applied' } },
        },
      },
      '/db/store': {
        post: {
          tags: ['sparql'],
          summary: 'Graph Store Protocol (bulk load Turtle / N-Triples)',
          description: '`?graph=` targets a named graph (also scopes cache invalidation); `?default` targets the default graph. DELETE drops the graph.',
          requestBody: { required: true, content: { 'text/turtle': { schema: { type: 'string' } }, 'application/n-triples': { schema: { type: 'string' } } } },
          responses: { 204: { description: 'Loaded' } },
        },
      },
      '/api/sql/sources': {
        get: { tags: ['sources'], summary: 'List attached datasources', responses: { 200: jsonRes({ type: 'array', items: ref('Source') }) } },
        post: {
          tags: ['sources'],
          summary: 'Attach a datasource',
          requestBody: jsonBody({
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['sqlite', 'postgres'], default: 'sqlite' },
              target: { type: 'string', description: 'file path (sqlite) or connection URL (postgres)' },
              id: { type: 'string' },
            },
            required: ['target'],
          }),
          responses: { 200: jsonRes(ref('Source')), 400: jsonRes(ref('Error'), 'Bad target / unreachable') },
        },
      },
      '/api/sql/sources/{id}': {
        delete: {
          tags: ['sources'],
          summary: 'Detach a datasource',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: jsonRes({ type: 'object', properties: { ok: { type: 'boolean' } } }) },
        },
      },
      '/api/sql/sources/{id}/schema': {
        get: {
          tags: ['sources'],
          summary: 'Introspect tables, columns, PKs, FKs, rowcounts',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: jsonRes({ type: 'object', properties: { id: { type: 'string' }, tables: { type: 'array', items: ref('Table') } } }) },
        },
      },
      '/api/sql/sources/{id}/translate': {
        post: {
          tags: ['sources'],
          summary: 'Translate schema → ontology + SHACL shapes + R2RML mappings',
          description: 'Writes the META layer only: classes, properties, shapes (with dash:LabelRole), R2RML TriplesMaps into the mappings graph, source descriptor. No instance data.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody({ type: 'object', properties: { graph: { type: 'string' }, namespace: { type: 'string' } } }, false),
          responses: { 200: jsonRes({ type: 'object', properties: { namespace: { type: 'string' }, tables: { type: 'integer' }, triples: { type: 'integer' }, mappingTriples: { type: 'integer' } } }) },
        },
      },
      '/api/sql/sources/{id}/query': {
        post: {
          tags: ['sources'],
          summary: 'Read-only SQL against one source',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody({ type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] }),
          responses: { 200: jsonRes({ type: 'object', properties: { columns: { type: 'array', items: { type: 'string' } }, rows: { type: 'array', items: { type: 'object' } }, truncated: { type: 'boolean' } } }), 400: jsonRes(ref('Error'), 'Not read-only / SQL error') },
        },
      },
    '/api/graphql': {
      post: {
        summary: 'Execute a GraphQL query over the shape-derived schema',
        description: 'SHACL node shapes generate the GraphQL types; virtual classes resolve from live SQL, meta classes from the graph.',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { query: { type: 'string' }, variables: { type: 'object' } }, required: ['query'] } } } },
        responses: { 200: { description: 'GraphQL execution result' } },
      },
    },
    '/api/graphql/sdl': {
      get: { summary: 'GraphQL SDL generated from SHACL shapes', responses: { 200: { description: 'SDL text' } } },
    },
      '/api/virtual/classes': {
        get: {
          tags: ['virtual'],
          summary: 'Virtual classes with live rowcounts',
          description: 'Every class mapped from an attached source, its owning database, table, live COUNT(*), and FIBO business area when discovered.',
          responses: { 200: jsonRes({ type: 'array', items: ref('VirtualClass') }) },
        },
      },
      '/api/virtual/instances': {
        post: {
          tags: ['virtual'],
          summary: 'List instances of a class — live from the owning database',
          requestBody: jsonBody({ type: 'object', properties: { classIri: { type: 'string' }, search: { type: 'string', description: 'LIKE filter on the dash:LabelRole column' }, limit: { type: 'integer' } }, required: ['classIri'] }),
          responses: { 200: jsonRes({ type: 'array', items: { type: 'object', properties: { iri: { type: 'string' }, label: { type: ['string', 'null'] } } } }) },
        },
      },
      '/api/virtual/describe': {
        post: {
          tags: ['virtual'],
          summary: 'Describe a virtual resource — one live row + cross-database link traversal',
          description: 'IRI is parsed against R2RML subject templates; column values, in-database FK objects, and declared field-level links (forward and reverse joins into other databases) are computed at query time.',
          requestBody: jsonBody({ type: 'object', properties: { iri: { type: 'string' } }, required: ['iri'] }),
          responses: { 200: jsonRes(ref('VirtualDescription')), 404: jsonRes(ref('Error'), 'Not a virtual resource') },
        },
      },
      '/api/federate/catalog': {
        get: { tags: ['federation'], summary: 'The KG-derived data catalog', description: 'Read from the R2RML mappings graph: class → source/table/columns/templates, enriched with FIBO business concepts.', responses: { 200: jsonRes({ type: 'object' }) } },
      },
      '/api/federate/plan': {
        post: {
          tags: ['federation'],
          summary: 'Which databases would a request over these classes touch?',
          requestBody: jsonBody({ type: 'object', properties: { classes: { type: 'array', items: { type: 'string' } } } }),
          responses: { 200: jsonRes({ type: 'object' }) },
        },
      },
      '/api/federate/query': {
        post: {
          tags: ['federation'],
          summary: 'Federated fetch: class in, live rows out (KG resolves the database)',
          requestBody: jsonBody({
            type: 'object',
            properties: {
              classIri: { type: 'string' },
              columns: { type: 'array', items: { type: 'string' } },
              filters: { type: 'array', items: { type: 'object', properties: { column: { type: 'string' }, op: { type: 'string', enum: ['=', '!=', '>', '<', '>=', '<=', 'LIKE'] }, value: {} }, required: ['column', 'value'] } },
              limit: { type: 'integer' },
            },
            required: ['classIri'],
          }),
          responses: { 200: jsonRes({ type: 'object', properties: { source: { type: 'object' }, table: { type: 'string' }, sql: { type: 'string' }, rows: { type: 'array', items: { type: 'object' } } } }) },
        },
      },
      '/api/discover/business-areas': {
        post: {
          tags: ['discovery'],
          summary: 'FIBO auto-discovery over every mapped field',
          description: 'Matches all catalog fields against the FIBO vocabulary graph (keywords live in the graph as skos:altLabel) and writes studio:businessConcept alignments. Idempotent.',
          responses: { 200: jsonRes({ type: 'object', properties: { fields: { type: 'integer' }, areas: { type: 'object' }, report: { type: 'array', items: { type: 'object' } } } }) },
        },
      },
      '/api/agent': {
        post: {
          tags: ['agent'],
          summary: 'Run the conversational agent (Grok + typed tools)',
          description: 'Tools: schema/catalog reads, ontology + shape authoring, declare_link (field-level connections), query_source_data (federated live fetch), discover_business_areas, read-only SPARQL. The model never writes raw update SPARQL and never puts instance data in the graph.',
          requestBody: jsonBody({ type: 'object', properties: { messages: { type: 'array', items: { type: 'object', properties: { role: { type: 'string', enum: ['user', 'assistant'] }, content: { type: 'string' } } } }, graph: { type: 'string' } }, required: ['messages'] }),
          responses: { 200: jsonRes({ type: 'object', properties: { reply: { type: 'string' }, trace: { type: 'array', items: { type: 'object', properties: { tool: { type: 'string' }, input: { type: 'string' }, ok: { type: 'boolean' } } } } } }) },
        },
      },
      '/api/health': { get: { tags: ['ops'], summary: 'Health + agent availability', responses: { 200: jsonRes({ type: 'object', properties: { ok: { type: 'boolean' }, sources: { type: 'integer' }, agent: { type: 'boolean' } } }) } } },
      '/api/cache/stats': { get: { tags: ['ops'], summary: 'Per-tier cache statistics (memory / disk / sql)', responses: { 200: jsonRes({ type: 'object' }) } } },
      '/api/cache/clear': { post: { tags: ['ops'], summary: 'Clear all cache tiers', responses: { 200: jsonRes({ type: 'object' }) } } },
    },
    components: {
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'string' } } },
        Source: {
          type: 'object',
          properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['sqlite', 'postgres'] }, target: { type: 'string', description: 'credentials stripped' }, tables: { type: 'integer' } },
        },
        Table: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            rowCount: { type: 'integer' },
            columns: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' }, notnull: { type: 'boolean' }, pk: { type: 'boolean' } } } },
            fks: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, table: { type: 'string' }, to: { type: 'string' } } } },
          },
        },
        VirtualClass: {
          type: 'object',
          properties: { classIri: { type: 'string' }, sourceId: { type: 'string' }, table: { type: 'string' }, rowCount: { type: 'integer' }, businessArea: { type: ['string', 'null'] } },
        },
        VirtualDescription: {
          type: 'object',
          properties: {
            iri: { type: 'string' },
            label: { type: ['string', 'null'] },
            types: { type: 'array', items: { type: 'string' } },
            outgoing: { type: 'array', items: { type: 'object' } },
            incoming: { type: 'array', items: { type: 'object' } },
            virtual: { type: 'object', properties: { sourceId: { type: 'string' }, table: { type: 'string' } } },
          },
        },
      },
    },
  };
}
