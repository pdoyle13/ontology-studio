// SHACL-AF rules engine: sh:TripleRule and sh:SPARQLRule attached to node
// shapes, materialized into a dedicated inferred graph. Explanations are
// computed on demand by re-running a rule's pattern against a specific
// triple — no per-triple provenance storage needed. No OWL anywhere.

import { sparql, metaStore } from '../core/meta.mjs';

const SH = 'http://www.w3.org/ns/shacl#';
export const INFERRED_GRAPH = 'https://studio.local/graphs/inferred';
const MAX_PASSES = 5;

/** Read every rule attached to a node shape (union scope). */
export async function readRules(oxigraph) {
  const rows = await sparql(
    oxigraph,
    `SELECT ?shape ?target ?rule ?type ?construct ?subj ?pred ?obj ?order ?deactivated WHERE {
      ?shape <${SH}rule> ?rule .
      OPTIONAL { ?shape <${SH}targetClass> ?target }
      OPTIONAL { ?rule a ?type . FILTER(?type IN (<${SH}TripleRule>, <${SH}SPARQLRule>)) }
      OPTIONAL { ?rule <${SH}construct> ?construct }
      OPTIONAL { ?rule <${SH}subject> ?subj }
      OPTIONAL { ?rule <${SH}predicate> ?pred }
      OPTIONAL { ?rule <${SH}object> ?obj }
      OPTIONAL { ?rule <${SH}order> ?order }
      OPTIONAL { ?rule <${SH}deactivated> ?deactivated }
    }`
  );
  const byRule = new Map();
  for (const b of rows) {
    if (!b.rule) continue;
    const key = b.rule.value;
    if (byRule.has(key)) continue;
    byRule.set(key, {
      ruleIri: key,
      shapeIri: b.shape.value,
      targetClass: b.target?.value ?? null,
      kind: b.construct ? 'sparql' : 'triple',
      construct: b.construct?.value ?? null,
      subject: b.subj?.value ?? null,
      predicate: b.pred?.value ?? null,
      object: b.obj ? { value: b.obj.value, isIri: b.obj.type === 'uri', datatype: b.obj.datatype, lang: b.obj['xml:lang'] } : null,
      order: b.order ? Number(b.order.value) : 0,
      deactivated: b.deactivated?.value === 'true',
    });
  }
  return [...byRule.values()].sort((a, b) => a.order - b.order);
}

const lit = (o) => {
  const esc = String(o.value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  if (o.lang) return `"${esc}"@${o.lang}`;
  if (o.datatype && o.datatype !== 'http://www.w3.org/2001/XMLSchema#string') return `"${esc}"^^<${o.datatype}>`;
  return `"${esc}"`;
};

/**
 * Pure: rule → SPARQL CONSTRUCT. TripleRules bind ?this to the shape's
 * target-class members (with subclass closure); sh:this in subject/object
 * substitutes the focus node. SPARQLRules run their sh:construct verbatim
 * (with $this pre-bound via the target class when present).
 */
export function compileRule(rule) {
  if (rule.kind === 'sparql') {
    if (!rule.construct) return null;
    let q = rule.construct;
    // SHACL-AF requires $this binding for target-scoped rules
    if (rule.targetClass && /[$?]this\b/.test(q)) {
      q = q.replace(
        /WHERE\s*\{/i,
        `WHERE { ?this a/<http://www.w3.org/2000/01/rdf-schema#subClassOf>* <${rule.targetClass}> .`
      ).replace(/\$this\b/g, '?this');
    }
    return q;
  }
  if (!rule.predicate || !rule.object || !rule.targetClass) return null;
  const SH_THIS = `${SH}this`;
  const s = !rule.subject || rule.subject === SH_THIS ? '?this' : `<${rule.subject}>`;
  const o = rule.object.isIri ? (rule.object.value === SH_THIS ? '?this' : `<${rule.object.value}>`) : lit(rule.object);
  return `CONSTRUCT { ${s} <${rule.predicate}> ${o} } WHERE { ?this a/<http://www.w3.org/2000/01/rdf-schema#subClassOf>* <${rule.targetClass}> . FILTER(isIRI(?this)) }`;
}

async function construct(oxigraph, query) {
  const text = await metaStore(oxigraph).query(query, { union: true, accept: 'application/n-triples' });
  return String(text).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

/**
 * Full re-materialization: wipe the inferred graph, run all active rules to a
 * fixpoint (rules can chain; capped passes). rawUpdate must bypass journaling
 * of intermediate states — pass the store's update function.
 */
export async function materialize({ oxigraph, rawUpdate }) {
  const rules = (await readRules(oxigraph)).filter((r) => !r.deactivated);
  await rawUpdate(`DROP SILENT GRAPH <${INFERRED_GRAPH}>`);
  const seen = new Set();
  const perRule = new Map(rules.map((r) => [r.ruleIri, 0]));
  let passes = 0;
  for (; passes < MAX_PASSES; passes++) {
    let added = 0;
    for (const rule of rules) {
      const q = compileRule(rule);
      if (!q) continue;
      let triples;
      try {
        triples = await construct(oxigraph, q);
      } catch {
        continue; // a broken rule never blocks the run
      }
      const fresh = triples.filter((t) => !seen.has(t));
      if (fresh.length === 0) continue;
      fresh.forEach((t) => seen.add(t));
      perRule.set(rule.ruleIri, (perRule.get(rule.ruleIri) ?? 0) + fresh.length);
      await rawUpdate(`INSERT DATA { GRAPH <${INFERRED_GRAPH}> { ${fresh.join('\n')} } }`);
      added += fresh.length;
    }
    if (added === 0) break;
  }
  return {
    rules: rules.length,
    derived: seen.size,
    passes: Math.min(passes + 1, MAX_PASSES),
    perRule: Object.fromEntries(perRule),
  };
}

/** Which rule(s) derive this exact triple? Re-runs each rule filtered to the triple. */
export async function explain({ oxigraph, s, p, o, oIsIri }) {
  const rules = (await readRules(oxigraph)).filter((r) => !r.deactivated);
  const culprits = [];
  for (const rule of rules) {
    const q = compileRule(rule);
    if (!q) continue;
    try {
      const triples = await construct(oxigraph, q);
      const objTerm = oIsIri ? `<${o}>` : null;
      const hit = triples.some((t) => {
        if (!t.startsWith(`<${s}> <${p}> `)) return false;
        return objTerm ? t.includes(objTerm) : t.includes(JSON.stringify(o).slice(1, -1));
      });
      if (hit) culprits.push({ ruleIri: rule.ruleIri, shapeIri: rule.shapeIri, kind: rule.kind, targetClass: rule.targetClass });
    } catch {
      /* skip broken rule */
    }
  }
  return culprits;
}
