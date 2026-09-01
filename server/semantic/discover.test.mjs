import { describe, it, expect } from 'vitest';
import { tokenize, matchField } from './discover.mjs';

const INDEX = [
    {
        iri: 'f:MonetaryAmount',
        label: 'Monetary Amount',
        area: 'Money & Accounting',
        keywords: ['amount', 'total', 'balance', 'salary', 'claim amount', 'total amount'],
    },
    {
        iri: 'f:Customer',
        label: 'Customer',
        area: 'Parties & People',
        keywords: ['customer', 'client', 'customer email'],
    },
    {
        iri: 'f:Identifier',
        label: 'Identifier',
        area: 'Identifiers',
        keywords: ['id', 'number', 'order number', 'tracking no'],
    },
    { iri: 'f:Date', label: 'Date', area: 'Dates & Times', keywords: ['date', 'created at', 'hired at'] },
    {
        iri: 'f:Contract',
        label: 'Contract',
        area: 'Agreements & Contracts',
        keywords: ['policy', 'contract', 'policy number'],
    },
];

describe('tokenize', () => {
    it('normalizes snake_case and camelCase to spaced lowercase', () => {
        expect(tokenize('claim_amount')).toBe('claim amount');
        expect(tokenize('orderNumber')).toBe('order number');
        expect(tokenize('IBAN')).toBe('iban');
    });
});

describe('matchField', () => {
    it('exact keyword phrase wins with top confidence', () => {
        const m = matchField('claim_amount', INDEX);
        expect(m?.concept.iri).toBe('f:MonetaryAmount');
        expect(m?.score).toBe(3);
    });

    it('prefers the longer, more specific keyword on ties', () => {
        // 'policy_number' matches Contract ('policy number' exact) over Identifier ('number' word)
        expect(matchField('policy_number', INDEX)?.concept.iri).toBe('f:Contract');
        expect(matchField('order_number', INDEX)?.concept.iri).toBe('f:Identifier');
    });

    it('matches single tokens inside compound names', () => {
        expect(matchField('gross_salary_2026', INDEX)?.concept.iri).toBe('f:MonetaryAmount');
        expect(matchField('customer_email', INDEX)?.concept.iri).toBe('f:Customer');
    });

    it('returns null when nothing matches', () => {
        expect(matchField('flux_capacitance', INDEX)).toBeNull();
    });
});
