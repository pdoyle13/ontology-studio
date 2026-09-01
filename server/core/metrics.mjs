// Observability: a tiny zero-dependency metrics registry with Prometheus
// text exposition and optional DogStatsD (Datadog agent) UDP export.
// Counters and histograms only — that covers request rates, latency, cache
// behavior, federation fan-out, and journal health.

import dgram from 'node:dgram';

export function createRegistry() {
    const counters = new Map(); // name -> Map(labelKey -> {labels, value})
    const histograms = new Map(); // name -> {buckets, series: Map(labelKey -> {labels, counts[], sum, count})}

    const labelKey = (labels = {}) =>
        Object.keys(labels)
            .sort()
            .map((k) => `${k}=${labels[k]}`)
            .join(',');

    function inc(name, labels = {}, delta = 1) {
        if (!counters.has(name)) counters.set(name, new Map());
        const series = counters.get(name);
        const key = labelKey(labels);
        if (!series.has(key)) series.set(key, { labels, value: 0 });
        series.get(key).value += delta;
    }

    function observe(name, value, labels = {}, buckets = [5, 25, 100, 250, 1000, 5000]) {
        if (!histograms.has(name)) histograms.set(name, { buckets, series: new Map() });
        const h = histograms.get(name);
        const key = labelKey(labels);
        if (!h.series.has(key))
            h.series.set(key, { labels, counts: new Array(h.buckets.length + 1).fill(0), sum: 0, count: 0 });
        const s = h.series.get(key);
        s.sum += value;
        s.count += 1;
        let placed = false;
        h.buckets.forEach((b, i) => {
            if (!placed && value <= b) {
                s.counts[i] += 1;
                placed = true;
            }
        });
        if (!placed) s.counts[h.buckets.length] += 1;
    }

    const fmtLabels = (labels, extra = null) => {
        const parts = Object.keys(labels)
            .sort()
            .map((k) => `${k}="${String(labels[k]).replace(/"/g, '\\"')}"`);
        if (extra) parts.push(extra);
        return parts.length ? `{${parts.join(',')}}` : '';
    };

    /** Prometheus text exposition format. */
    function promText() {
        const lines = [];
        for (const [name, series] of counters) {
            lines.push(`# TYPE ${name} counter`);
            for (const { labels, value } of series.values()) lines.push(`${name}${fmtLabels(labels)} ${value}`);
        }
        for (const [name, h] of histograms) {
            lines.push(`# TYPE ${name} histogram`);
            for (const s of h.series.values()) {
                let cum = 0;
                h.buckets.forEach((b, i) => {
                    cum += s.counts[i];
                    lines.push(`${name}_bucket${fmtLabels(s.labels, `le="${b}"`)} ${cum}`);
                });
                cum += s.counts[h.buckets.length];
                lines.push(`${name}_bucket${fmtLabels(s.labels, 'le="+Inf"')} ${cum}`);
                lines.push(`${name}_sum${fmtLabels(s.labels)} ${s.sum}`);
                lines.push(`${name}_count${fmtLabels(s.labels)} ${s.count}`);
            }
        }
        const mem = process.memoryUsage();
        lines.push('# TYPE process_resident_memory_bytes gauge');
        lines.push(`process_resident_memory_bytes ${mem.rss}`);
        lines.push('# TYPE process_uptime_seconds gauge');
        lines.push(`process_uptime_seconds ${Math.round(process.uptime())}`);
        return lines.join('\n') + '\n';
    }

    /** DogStatsD export: fire-and-forget UDP to the Datadog agent. */
    function startStatsd({
        host = process.env.DD_AGENT_HOST,
        port = Number(process.env.DD_DOGSTATSD_PORT ?? 8125),
        intervalMs = 10000,
        prefix = 'ontology_studio.',
    } = {}) {
        if (!host) return null;
        const sock = dgram.createSocket('udp4');
        let last = new Map();
        const timer = setInterval(() => {
            const lines = [];
            for (const [name, series] of counters) {
                for (const [key, { labels, value }] of series) {
                    const prev = last.get(`${name}|${key}`) ?? 0;
                    const delta = value - prev;
                    last.set(`${name}|${key}`, value);
                    if (delta > 0) {
                        const tags = Object.entries(labels)
                            .map(([k, v]) => `${k}:${v}`)
                            .join(',');
                        lines.push(`${prefix}${name}:${delta}|c${tags ? `|#${tags}` : ''}`);
                    }
                }
            }
            if (lines.length) sock.send(Buffer.from(lines.join('\n')), port, host, () => {});
        }, intervalMs);
        timer.unref?.();
        return {
            stop: () => {
                clearInterval(timer);
                sock.close();
            },
        };
    }

    /** Express middleware: request counts + latency histogram, coarse route class. */
    function httpMiddleware() {
        return (req, res, next) => {
            const started = performance.now();
            res.on('finish', () => {
                const route = req.path.startsWith('/api/')
                    ? `/api/${req.path.split('/')[2] ?? ''}`
                    : req.path.startsWith('/es')
                      ? '/es'
                      : req.path.startsWith('/db')
                        ? '/db'
                        : 'other';
                inc('http_requests_total', { route, method: req.method, status: String(res.statusCode) });
                observe('http_request_duration_ms', performance.now() - started, { route });
            });
            next();
        };
    }

    return { inc, observe, promText, startStatsd, httpMiddleware };
}
