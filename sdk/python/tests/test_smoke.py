"""Live smoke test against a running YAOE server (like the e2e suite).

Run:  python -m unittest discover sdk/python/tests
"""

import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from yaoe import Yaoe, YaoeError  # noqa: E402

TAG = f"pysdk{int(time.time() * 1000) % 100000000:x}"
G = "https://example.org/graphs/music"


class SmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.y = Yaoe("http://localhost:7881", user="pat")

    def test_01_sparql_select_and_ask(self):
        rows = self.y.sparql("SELECT ?s WHERE { ?s a <https://example.org/music#Artist> } LIMIT 3")
        self.assertTrue(len(rows) >= 1)
        self.assertIn("s", rows[0])
        ask = self.y.sparql("ASK { ?s a <https://example.org/music#Artist> }")
        self.assertEqual(ask, [{"boolean": True}])

    def test_02_update_roundtrip_and_governance(self):
        iri = f"https://example.org/music#Py{TAG}"
        self.y.update(f'INSERT DATA {{ GRAPH <{G}> {{ <{iri}> a <https://example.org/music#Artist> }} }}')
        rows = self.y.sparql(f"SELECT ?t WHERE {{ <{iri}> a ?t }}")
        self.assertEqual(rows[0]["t"], "https://example.org/music#Artist")
        self.y.update(f'DELETE DATA {{ GRAPH <{G}> {{ <{iri}> a <https://example.org/music#Artist> }} }}')
        # governed graph as viewer → YaoeError(403)
        viewer = Yaoe("http://localhost:7881", user="rando-viewer")
        with self.assertRaises(YaoeError) as ctx:
            viewer.update('INSERT DATA { GRAPH <https://studio.local/graphs/lineage> { <https://x/a> <https://x/b> "c" } }')
        self.assertEqual(ctx.exception.status, 403)

    def test_03_search_graphql_reconcile(self):
        self.assertTrue(len(self.y.search("turing")["hits"]) >= 0)
        data = self.y.graphql("{ orders(limit: 2) { orderNumber status } }")
        self.assertEqual(len(data["orders"]), 2)
        rec = self.y.reconcile({"q0": {"query": "Alan Turing", "limit": 2}})
        self.assertTrue(rec["q0"]["result"][0]["match"])

    def test_04_virtual_and_federation(self):
        classes = self.y.virtual_classes()
        self.assertTrue(len(classes) > 10)
        fed = self.y.federate(
            "https://studio.local/sql/sales_db#orders",
            filters=[{"column": "status", "op": "=", "value": "shipped"}],
            limit=3,
        )
        self.assertEqual(len(fed["rows"]), 3)

    def test_05_tagging(self):
        tags = self.y.tag("no concepts from any scheme appear in this nonsense zxqv text")
        self.assertIsInstance(tags, list)

    def test_06_error_shape(self):
        with self.assertRaises(YaoeError) as ctx:
            self.y._json("POST", "/api/tag", {})
        self.assertEqual(ctx.exception.status, 400)


if __name__ == "__main__":
    unittest.main(verbosity=2)
