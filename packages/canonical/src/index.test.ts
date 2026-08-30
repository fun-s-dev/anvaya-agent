import { describe, expect, it } from 'vitest';

import {
  appendCanonicalFinancialEffect,
  createCanonicalFinancialEffect,
} from './index.js';

describe('canonical financial effect uniqueness', () => {
  it('rejects duplicate canonical financial effects for the same stable source record', () => {
    const candidate = createCanonicalFinancialEffect({
      provider: 'razorpay',
      sourceType: 'psp',
      sourceRecordId: 'pay_123',
      amountMinor: 1000,
      currency: 'INR',
      financialEffectMinor: 1000,
    });

    const existing = [candidate];

    expect(() => appendCanonicalFinancialEffect(existing, candidate)).toThrow(
      /Duplicate canonical financial effect/i,
    );
  });

  it('allows distinct source records to coexist', () => {
    const first = createCanonicalFinancialEffect({
      provider: 'razorpay',
      sourceType: 'psp',
      sourceRecordId: 'pay_123',
      amountMinor: 1000,
      currency: 'INR',
      financialEffectMinor: 1000,
    });

    const second = createCanonicalFinancialEffect({
      provider: 'razorpay',
      sourceType: 'psp',
      sourceRecordId: 'pay_456',
      amountMinor: 2000,
      currency: 'INR',
      financialEffectMinor: 2000,
    });

    expect(appendCanonicalFinancialEffect([first], second)).toEqual([first, second]);
  });
});
