// Dependency-free SVG chart components for dashboard widgets. The layout
// math is exported pure for tests; rendering stays minimal and on-theme.

export interface Datum {
    x: string;
    y: number;
}

/** Pure: rows + field picks → clean numeric series (bad rows dropped). */
export function toSeries(rows: Record<string, unknown>[], xField: string, yField: string): Datum[] {
    return rows
        .map((r) => ({ x: String(r[xField] ?? ''), y: Number(r[yField]) }))
        .filter((d) => d.x !== '' && Number.isFinite(d.y));
}

/** Pure: nice axis maximum (1/2/5 × 10^k at or above the data max). */
export function niceMax(max: number): number {
    if (max <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(max)));
    for (const m of [1, 2, 5, 10]) if (m * pow >= max) return m * pow;
    return 10 * pow;
}

/** Pure: pie slice angles (radians, clockwise from 12 o'clock). */
export function pieLayout(data: Datum[]): { d: Datum; start: number; end: number }[] {
    const total = data.reduce((s, d) => s + d.y, 0);
    if (total <= 0) return [];
    let angle = -Math.PI / 2;
    return data.map((d) => {
        const span = (d.y / total) * 2 * Math.PI;
        const out = { d, start: angle, end: angle + span };
        angle += span;
        return out;
    });
}

const ACCENT = 'var(--accent)';
const PALETTE = ['#d29a4b', '#7d9c65', '#6d8fb5', '#b56d6d', '#9a7db5', '#b5a36d', '#6db5a8', '#b57d9c'];

export function BarChart({ data, height = 180 }: { data: Datum[]; height?: number }) {
    if (data.length === 0) return <div className="term-meta">no data</div>;
    const max = niceMax(Math.max(...data.map((d) => d.y)));
    const bw = Math.max(18, Math.min(64, Math.floor(560 / data.length) - 8));
    const width = data.length * (bw + 8) + 40;
    return (
        <svg viewBox={`0 0 ${width} ${height + 34}`} className="chart" role="img">
            {data.map((d, i) => {
                const h = (d.y / max) * height;
                const x = 36 + i * (bw + 8);
                return (
                    <g key={i}>
                        <rect
                            x={x}
                            y={height - h + 4}
                            width={bw}
                            height={h}
                            fill={ACCENT}
                            opacity={0.85}
                            data-bar={d.x}
                        />
                        <text x={x + bw / 2} y={height + 16} textAnchor="middle" className="chart-label">
                            {d.x.slice(0, 10)}
                        </text>
                        <text x={x + bw / 2} y={height - h - 2} textAnchor="middle" className="chart-value">
                            {d.y}
                        </text>
                    </g>
                );
            })}
            <line x1={32} y1={4} x2={32} y2={height + 4} className="chart-axis" />
            <text x={28} y={12} textAnchor="end" className="chart-label">
                {max}
            </text>
            <text x={28} y={height + 4} textAnchor="end" className="chart-label">
                0
            </text>
        </svg>
    );
}

export function LineChart({ data, height = 180 }: { data: Datum[]; height?: number }) {
    if (data.length === 0) return <div className="term-meta">no data</div>;
    const max = niceMax(Math.max(...data.map((d) => d.y)));
    const width = 580;
    const step = (width - 60) / Math.max(1, data.length - 1);
    const pts = data.map((d, i) => [40 + i * step, 4 + height - (d.y / max) * height] as const);
    return (
        <svg viewBox={`0 0 ${width} ${height + 34}`} className="chart" role="img">
            <polyline points={pts.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={ACCENT} strokeWidth={2} />
            {pts.map(([x, y], i) => (
                <g key={i}>
                    <circle cx={x} cy={y} r={3} fill={ACCENT} />
                    <text x={x} y={height + 16} textAnchor="middle" className="chart-label">
                        {data[i].x.slice(0, 8)}
                    </text>
                </g>
            ))}
            <line x1={36} y1={4} x2={36} y2={height + 4} className="chart-axis" />
            <text x={32} y={12} textAnchor="end" className="chart-label">
                {max}
            </text>
        </svg>
    );
}

export function PieChart({ data, size = 200 }: { data: Datum[]; size?: number }) {
    const slices = pieLayout(data);
    if (slices.length === 0) return <div className="term-meta">no data</div>;
    const r = size / 2 - 4;
    const c = size / 2;
    const arc = (start: number, end: number) => {
        const large = end - start > Math.PI ? 1 : 0;
        const x1 = c + r * Math.cos(start);
        const y1 = c + r * Math.sin(start);
        const x2 = c + r * Math.cos(end);
        const y2 = c + r * Math.sin(end);
        return `M ${c} ${c} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    };
    return (
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="chart" role="img">
                {slices.map((s, i) => (
                    <path key={i} d={arc(s.start, s.end)} fill={PALETTE[i % PALETTE.length]} data-slice={s.d.x} />
                ))}
            </svg>
            <ul className="chart-legend">
                {slices.map((s, i) => (
                    <li key={i}>
                        <span className="swatch" style={{ background: PALETTE[i % PALETTE.length] }} /> {s.d.x} —{' '}
                        {s.d.y}
                    </li>
                ))}
            </ul>
        </div>
    );
}

export function Kpi({
    rows,
    yField,
    label,
}: {
    rows: Record<string, unknown>[];
    yField: string | null;
    label: string;
}) {
    const first = rows[0] ?? {};
    const key = yField ?? Object.keys(first)[0];
    const value = first[key as keyof typeof first];
    return (
        <div className="kpi">
            <div className="kpi-value">{value === undefined || value === null ? '—' : String(value)}</div>
            <div className="kpi-label">{label}</div>
        </div>
    );
}
