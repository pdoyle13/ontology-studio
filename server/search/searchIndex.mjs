// Embedded full-text engine: inverted index + BM25, speaking the
// Elasticsearch/OpenSearch query DSL (the subset real clients send).
// Pure in-memory structure — the service layer decides what to index and when.

const BM25_K1 = 1.2;
const BM25_B = 0.75;

export function tokenize(text) {
    return String(text ?? '')
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length > 0);
}

/** Edge n-grams (min 2) so the omnibox matches as you type: "turing" ← "tu","tur",… */
function edgeGrams(token, max = 12) {
    const out = [];
    for (let i = 2; i <= Math.min(token.length, max); i++) out.push(token.slice(0, i));
    return out;
}

export class SearchIndex {
    constructor() {
        this.docs = new Map(); // id → {source, fieldTokens: Map<field, tokens[]>}
        this.postings = new Map(); // `${field}:${term}` → Map<id, tf>
        this.prefixPostings = new Map(); // `${field}:${gram}` → Set<id>
        this.fieldLenSum = new Map(); // field → total tokens
    }

    get size() {
        return this.docs.size;
    }

    add(id, source, textFields) {
        if (this.docs.has(id)) this.remove(id);
        const raw = {};
        for (const [field, value] of Object.entries(textFields))
            raw[field] = Array.isArray(value) ? value.join(' ') : String(value ?? '');
        const fieldTokens = new Map();
        for (const [field, value] of Object.entries(textFields)) {
            const tokens = tokenize(Array.isArray(value) ? value.join(' ') : value);
            if (tokens.length === 0) continue;
            fieldTokens.set(field, tokens);
            this.fieldLenSum.set(field, (this.fieldLenSum.get(field) ?? 0) + tokens.length);
            const counts = new Map();
            for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
            for (const [term, tf] of counts) {
                const key = `${field}:${term}`;
                if (!this.postings.has(key)) this.postings.set(key, new Map());
                this.postings.get(key).set(id, tf);
                for (const gram of edgeGrams(term)) {
                    const pkey = `${field}:${gram}`;
                    if (!this.prefixPostings.has(pkey)) this.prefixPostings.set(pkey, new Set());
                    this.prefixPostings.get(pkey).add(id);
                }
            }
        }
        this.docs.set(id, { source, fieldTokens, raw });
    }

    remove(id) {
        const doc = this.docs.get(id);
        if (!doc) return;
        for (const [field, tokens] of doc.fieldTokens) {
            this.fieldLenSum.set(field, (this.fieldLenSum.get(field) ?? 0) - tokens.length);
            const seen = new Set(tokens);
            for (const term of seen) {
                this.postings.get(`${field}:${term}`)?.delete(id);
                for (const gram of edgeGrams(term)) this.prefixPostings.get(`${field}:${gram}`)?.delete(id);
            }
        }
        this.docs.delete(id);
    }

    clear() {
        this.docs.clear();
        this.postings.clear();
        this.prefixPostings.clear();
        this.fieldLenSum.clear();
    }

    #bm25(field, term, boost = 1) {
        const posting = this.postings.get(`${field}:${term}`);
        if (!posting) return new Map();
        const N = this.docs.size;
        const df = posting.size;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const avgLen = (this.fieldLenSum.get(field) ?? 0) / Math.max(1, N);
        const scores = new Map();
        for (const [id, tf] of posting) {
            const len = this.docs.get(id)?.fieldTokens.get(field)?.length ?? 0;
            const s =
                (idf * (tf * (BM25_K1 + 1))) / (tf + BM25_K1 * (1 - BM25_B + (BM25_B * len) / Math.max(1, avgLen)));
            scores.set(id, s * boost);
        }
        return scores;
    }

    #prefix(field, gram, boost = 0.3) {
        const ids = this.prefixPostings.get(`${field}:${gram.toLowerCase()}`);
        const scores = new Map();
        if (ids) for (const id of ids) scores.set(id, boost);
        return scores;
    }

    /** match query: every token scored per field; last token also as prefix. */
    matchScores(fields, queryText, { prefixLast = true } = {}) {
        const tokens = tokenize(queryText);
        const total = new Map();
        const merge = (m) => {
            for (const [id, s] of m) total.set(id, (total.get(id) ?? 0) + s);
        };
        tokens.forEach((tok, i) => {
            for (const { field, boost } of fields) {
                merge(this.#bm25(field, tok, boost));
                if (prefixLast && i === tokens.length - 1 && tok.length >= 2)
                    merge(this.#prefix(field, tok, 0.3 * boost));
            }
        });
        return total;
    }
}

// ---------- ES/OpenSearch query DSL execution ----------

function parseFieldSpec(f) {
    const m = String(f).match(/^(.+?)\^(\d+(?:\.\d+)?)$/);
    return m ? { field: m[1], boost: Number(m[2]) } : { field: f, boost: 1 };
}

const DEFAULT_FIELDS = [
    { field: 'label', boost: 3 },
    { field: 'text', boost: 1 },
];

/** Execute an ES-style query object → Map<id, score>. Supports the subset real clients send. */
export function executeQuery(index, query) {
    if (!query || query.match_all) {
        const all = new Map();
        for (const id of index.docs.keys()) all.set(id, 1);
        return all;
    }
    if (query.match) {
        const [field, spec] = Object.entries(query.match)[0];
        const text = typeof spec === 'object' ? spec.query : spec;
        return index.matchScores([{ field, boost: 1 }], text);
    }
    if (query.multi_match) {
        const fields = (query.multi_match.fields ?? ['label^3', 'text']).map(parseFieldSpec);
        return index.matchScores(fields, query.multi_match.query);
    }
    if (query.query_string) {
        const fields = (query.query_string.fields ?? []).map(parseFieldSpec);
        return index.matchScores(fields.length ? fields : DEFAULT_FIELDS, query.query_string.query);
    }
    if (query.prefix) {
        const [field, spec] = Object.entries(query.prefix)[0];
        const value = typeof spec === 'object' ? spec.value : spec;
        return index.matchScores([{ field, boost: 1 }], value);
    }
    if (query.term) {
        const [field, spec] = Object.entries(query.term)[0];
        const value = typeof spec === 'object' ? spec.value : spec;
        const out = new Map();
        for (const [id, doc] of index.docs) {
            if (String(doc.source[field] ?? '') === String(value)) out.set(id, 1);
        }
        return out;
    }
    if (query.bool) {
        const { must = [], should = [], filter = [], must_not = [] } = query.bool;
        const arr = (x) => (Array.isArray(x) ? x : [x]);
        let result = null; // Map id→score
        for (const q of [...arr(must), ...arr(filter)]) {
            const scores = executeQuery(index, q);
            if (result === null) result = scores;
            else {
                for (const id of [...result.keys()]) {
                    if (!scores.has(id)) result.delete(id);
                    else result.set(id, result.get(id) + scores.get(id));
                }
            }
        }
        if (result === null) {
            result = new Map();
            if (arr(should).length) for (const id of index.docs.keys()) result.set(id, 0);
        }
        for (const q of arr(should)) {
            const scores = executeQuery(index, q);
            for (const [id, s] of scores) if (result.has(id)) result.set(id, result.get(id) + s);
        }
        if (arr(should).length && !arr(must).length && !arr(filter).length) {
            for (const id of [...result.keys()]) if (result.get(id) === 0) result.delete(id);
        }
        for (const q of arr(must_not)) {
            const scores = executeQuery(index, q);
            for (const id of scores.keys()) result.delete(id);
        }
        return result;
    }
    return new Map();
}

/** Pure: terms aggregation over a stored source field. */
export function termsAgg(index, ids, field, size = 20) {
    const counts = new Map();
    for (const id of ids) {
        const v = index.docs.get(id)?.source?.[field];
        if (v === undefined || v === null) continue;
        counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, size)
        .map(([key, doc_count]) => ({ key, doc_count }));
}

/** Pure: highlight query tokens in raw text as <em> fragments. */
export function highlight(rawText, queryText, fragLen = 90) {
    const text = String(rawText ?? '');
    const tokens = tokenize(queryText).filter((t) => t.length >= 2);
    if (!text || tokens.length === 0) return null;
    const lower = text.toLowerCase();
    let first = -1;
    for (const t of tokens) {
        const i = lower.indexOf(t);
        if (i >= 0 && (first < 0 || i < first)) first = i;
    }
    if (first < 0) return null;
    const start = Math.max(0, first - Math.floor(fragLen / 3));
    let frag = text.slice(start, start + fragLen);
    for (const t of tokens) {
        frag = frag.replace(new RegExp(`(${t.replace(/[.*+?^${'{'}${'}'}()|[\]\\]/g, '\\$&')})`, 'ig'), '<em>$1</em>');
    }
    return (start > 0 ? '…' : '') + frag + (start + fragLen < text.length ? '…' : '');
}

/** Full _search: body → ES-shaped response (query, from/size, aggs, highlight). */
export function search(index, body = {}, { indexName = 'studio' } = {}) {
    const started = performance.now();
    const scores = executeQuery(index, body.query ?? { match_all: {} });
    const from = body.from ?? 0;
    const size = body.size ?? 10;
    const allIds = [...scores.keys()];
    const ranked = [...scores.entries()]
        .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
        .slice(from, from + size);
    const queryText =
        body.query?.multi_match?.query ??
        body.query?.query_string?.query ??
        (body.query?.match ? (Object.values(body.query.match)[0]?.query ?? Object.values(body.query.match)[0]) : null);
    const wantHl = body.highlight != null;
    const result = {
        took: Math.max(0, Math.round(performance.now() - started)),
        timed_out: false,
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        hits: {
            total: { value: scores.size, relation: 'eq' },
            max_score: ranked[0]?.[1] ?? null,
            hits: ranked.map(([id, score]) => {
                const doc = index.docs.get(id);
                const hit = { _index: indexName, _id: id, _score: score, _source: doc?.source ?? {} };
                if (wantHl && queryText) {
                    const frag = highlight(doc?.raw?.text ?? doc?.raw?.label ?? '', String(queryText));
                    if (frag) hit.highlight = { text: [frag] };
                }
                return hit;
            }),
        },
    };
    if (body.aggs) {
        result.aggregations = {};
        for (const [name, spec] of Object.entries(body.aggs)) {
            if (spec.terms?.field)
                result.aggregations[name] = {
                    buckets: termsAgg(index, allIds, spec.terms.field, spec.terms.size ?? 20),
                };
        }
    }
    return result;
}
