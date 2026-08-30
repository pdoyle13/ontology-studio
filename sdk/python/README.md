# ontology-studio — Python client

Dependency-free client for the Ontology Studio HTTP API.

```bash
pip install -e sdk/python
```

```python
from ontology_studio import Studio

y = Studio("http://localhost:7881", user="pat")          # dev header auth
# y = Studio("http://localhost:7881", token="ostudio_...")  # API-token auth

# SPARQL (union scope by default; pass graph= to scope)
rows = y.sparql("SELECT ?s WHERE { ?s a <https://example.org/music#Artist> } LIMIT 5")

# writes go through the same governance as the UI
y.update('INSERT DATA { GRAPH <https://example.org/graphs/music> { <https://x/a> <https://x/p> "v" } }')

# search / GraphQL / reconciliation / tagging
y.search("turing")
y.graphql("{ orders(limit: 2) { orderNumber status } }")
y.reconcile({"q0": {"query": "Alan Turing", "limit": 3}})
y.tag("Jazz Fusion blends jazz with rock")

# virtual layer + federation over live SQL
y.virtual_classes()
y.federate("https://studio.local/sql/sales_db#orders",
           filters=[{"column": "status", "op": "=", "value": "shipped"}], limit=10)

# crosswalks
y.crosswalk_suggest(scheme_a, scheme_b)
```

Errors raise `StudioError` with the server's status and message.
