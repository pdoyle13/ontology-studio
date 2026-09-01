// XSS-safety tests for search-highlight rendering (remediation P1.7).
import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';
import { renderHighlight } from './Omnibox';

const isEm = (n: unknown): n is ReactElement =>
    typeof n === 'object' && n !== null && (n as ReactElement).type === 'em';

describe('renderHighlight', () => {
    it('renders <em> matches as elements and the rest as plain strings', () => {
        const out = renderHighlight('the <em>quick</em> fox');
        expect(out).toHaveLength(3);
        expect(out[0]).toBe('the ');
        expect(isEm(out[1])).toBe(true);
        expect((out[1] as ReactElement<{ children: string }>).props.children).toBe('quick');
        expect(out[2]).toBe(' fox');
    });

    it('keeps injected markup as a plain string (React will escape it)', () => {
        const out = renderHighlight('<img src=x onerror=alert(1)> and <em>hi</em>');
        expect(typeof out[0]).toBe('string');
        expect(out[0]).toContain('<img');
        expect(out.some(isEm)).toBe(true);
    });

    it('escapes markup even inside an <em> match (string child, not HTML)', () => {
        const out = renderHighlight('<em><script>alert(1)</script></em>');
        expect(isEm(out[0])).toBe(true);
        expect((out[0] as ReactElement<{ children: string }>).props.children).toBe('<script>alert(1)</script>');
    });

    it('handles plain text with no markers', () => {
        expect(renderHighlight('nothing here')).toEqual(['nothing here']);
    });
});
