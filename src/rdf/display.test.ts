import { describe, it, expect } from 'vitest';
import { humanize, displayName } from './display';

describe('humanize', () => {
    it('splits snake_case and camelCase into Title Case', () => {
        expect(humanize('order_number')).toBe('Order Number');
        expect(humanize('firstName')).toBe('First Name');
        expect(humanize('shipping-address')).toBe('Shipping Address');
    });

    it('preserves short all-caps acronyms', () => {
        expect(humanize('USD')).toBe('USD');
        expect(humanize('id')).toBe('Id'); // lowercase short words are title-cased
    });

    it('lowercases the tail of long words', () => {
        expect(humanize('ORDERS')).toBe('Orders');
    });

    it('collapses mixed separators and whitespace', () => {
        expect(humanize('  foo__bar  baz ')).toBe('Foo Bar Baz');
    });
});

describe('displayName', () => {
    it('prefers a non-empty label', () => {
        expect(displayName('https://x/Thing', 'My Thing')).toBe('My Thing');
    });

    it('falls back to a humanized local name when no label', () => {
        expect(displayName('https://ex.org/model#order_number')).toBe('Order Number');
        expect(displayName('https://ex.org/vocab/ShippingAddress', '')).toBe('Shipping Address');
        expect(displayName('https://ex.org/vocab/ShippingAddress', '   ')).toBe('Shipping Address');
    });
});
