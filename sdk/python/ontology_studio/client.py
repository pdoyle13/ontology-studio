"""Ontology Studio Python client — a thin, dependency-free wrapper over the HTTP API.

Every method maps 1:1 to a documented endpoint (GET /api/openapi.json for the
full surface). Auth: pass an API token (Bearer) or a user name (dev header).

    from ontology_studio import Studio
    y = Studio("http://localhost:7881", user="pat")
    rows = y.sparql("SELECT ?s WHERE { ?s a <https://example.org/music#Artist> } LIMIT 5")
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Any, Optional


class StudioError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


class Studio:
    def __init__(self, base_url: str = "http://localhost:7881", token: Optional[str] = None, user: Optional[str] = None, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.user = user
        self.timeout = timeout

    # ---- plumbing ----

    def _headers(self, content_type: Optional[str] = None, accept: str = "application/json") -> dict:
        h = {"Accept": accept}
        if content_type:
            h["Content-Type"] = content_type
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        elif self.user:
            h["X-Studio-User"] = self.user
        return h

    def _request(self, method: str, path: str, body: Optional[bytes] = None, content_type: Optional[str] = None, accept: str = "application/json") -> Any:
        req = urllib.request.Request(
            f"{self.base_url}{path}", data=body, method=method, headers=self._headers(content_type, accept)
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                raw = res.read()
        except urllib.error.HTTPError as e:  # surface the server's error body
            detail = e.read().decode("utf-8", "replace")
            try:
                detail = json.loads(detail).get("error", detail)
            except Exception:
                pass
            raise StudioError(e.code, detail) from None
        if not raw:
            return None
        if accept == "application/json" or raw[:1] in (b"{", b"["):
            return json.loads(raw)
        return raw.decode("utf-8")

    def _json(self, method: str, path: str, payload: Any = None) -> Any:
        body = json.dumps(payload).encode() if payload is not None else None
        return self._request(method, path, body, "application/json" if body else None)

    # ---- SPARQL ----

    def sparql(self, query: str, graph: Optional[str] = None, union: bool = True) -> list[dict]:
        """SELECT/ASK bindings as a list of {var: value} dicts (ASK → [{'boolean': bool}])."""
        qs = ""
        if graph:
            qs = "?" + urllib.parse.urlencode({"default-graph-uri": graph})
        elif union:
            qs = "?union-default-graph="
        res = self._request("POST", f"/db/query{qs}", query.encode(), "application/sparql-query", "application/sparql-results+json")
        if "boolean" in res:
            return [{"boolean": res["boolean"]}]
        return [{k: v.get("value") for k, v in b.items()} for b in res["results"]["bindings"]]

    def construct(self, query: str, graph: Optional[str] = None) -> str:
        """CONSTRUCT/DESCRIBE as Turtle text."""
        qs = "?" + urllib.parse.urlencode({"default-graph-uri": graph}) if graph else "?union-default-graph="
        return self._request("POST", f"/db/query{qs}", query.encode(), "application/sparql-query", "text/turtle")

    def update(self, update: str) -> None:
        """SPARQL UPDATE (governance-gated like the UI)."""
        self._request("POST", "/db/update", update.encode(), "application/sparql-update", "*/*")

    # ---- search / graphql / reconcile / tagging ----

    def search(self, q: str, limit: int = 20) -> Any:
        return self._json("GET", "/api/search?" + urllib.parse.urlencode({"q": q, "limit": limit}))

    def graphql(self, query: str, variables: Optional[dict] = None) -> Any:
        out = self._json("POST", "/api/graphql", {"query": query, "variables": variables or {}})
        if out.get("errors"):
            raise StudioError(200, json.dumps(out["errors"]))
        return out["data"]

    def reconcile(self, queries: dict) -> Any:
        """W3C reconciliation batch: {'q0': {'query': 'Alan Turing', 'limit': 3}}."""
        return self._json("POST", "/api/reconcile", {"queries": queries})

    def tag(self, text: str, scheme: Optional[str] = None) -> list[dict]:
        """Auto-tag free text with taxonomy concepts."""
        return self._json("POST", "/api/tag", {"text": text, "scheme": scheme})

    # ---- virtual layer / federation ----

    def virtual_classes(self) -> list[dict]:
        return self._json("GET", "/api/virtual/classes")

    def virtual_instances(self, class_iri: str, limit: int = 50, search: str = "") -> list[dict]:
        return self._json("POST", "/api/virtual/instances", {"classIri": class_iri, "limit": limit, "search": search})

    def describe(self, iri: str) -> dict:
        return self._json("POST", "/api/virtual/describe", {"iri": iri})

    def federate(self, class_iri: str, filters: Optional[list[dict]] = None, limit: int = 200, offset: int = 0, order_by: Optional[dict] = None, columns: Optional[list[str]] = None) -> dict:
        return self._json("POST", "/api/federate/query", {
            "classIri": class_iri, "filters": filters, "limit": limit, "offset": offset,
            "orderBy": order_by, "columns": columns,
        })

    # ---- crosswalks ----

    def crosswalk_suggest(self, from_scheme: str, to_scheme: str) -> dict:
        qs = urllib.parse.urlencode({"from": from_scheme, "to": to_scheme})
        return self._json("GET", f"/api/crosswalk/suggest?{qs}")

    def crosswalk_accept(self, from_iri: str, to_iri: str, relation: str = "exactMatch") -> dict:
        return self._json("POST", "/api/crosswalk", {"from": from_iri, "to": to_iri, "relation": relation})

    def crosswalk_remove(self, from_iri: str, to_iri: str, relation: str) -> dict:
        return self._json("DELETE", "/api/crosswalk", {"from": from_iri, "to": to_iri, "relation": relation})

    # ---- misc ----

    def openapi(self) -> dict:
        return self._json("GET", "/api/openapi.json")

    def quality_history(self) -> Any:
        return self._json("GET", "/api/quality")
