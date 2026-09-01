import { describe, it, expect } from 'vitest';
import { toSeries, niceMax, pieLayout } from './charts';

describe('toSeries', () => {
    it('extracts x/y and drops unusable rows', () => {
        const rows = [
            { status: 'shipped', n: '42' },
            { status: 'pending', n: 7 },
            { status: '', n: 3 },
            { status: 'bad', n: 'NaN-ish' },
        ];
        expect(toSeries(rows, 'status', 'n')).toEqual([
            { x: 'shipped', y: 42 },
            { x: 'pending', y: 7 },
        ]);
    });
});

describe('niceMax', () => {
    it('rounds up to 1/2/5 steps', () => {
        expect(niceMax(7)).toBe(10);
        expect(niceMax(42)).toBe(50);
        expect(niceMax(199)).toBe(200);
        expect(niceMax(200)).toBe(200);
        expect(niceMax(0)).toBe(1);
    });
});

describe('pieLayout', () => {
    it('splits the circle proportionally starting at 12 o’clock', () => {
        const slices = pieLayout([
            { x: 'a', y: 1 },
            { x: 'b', y: 3 },
        ]);
        expect(slices).toHaveLength(2);
        expect(slices[0].start).toBeCloseTo(-Math.PI / 2);
        expect(slices[0].end - slices[0].start).toBeCloseTo(Math.PI / 2);
        expect(slices[1].end).toBeCloseTo((3 * Math.PI) / 2);
    });

    it('empty on zero totals', () => {
        expect(pieLayout([{ x: 'a', y: 0 }])).toEqual([]);
    });
});
