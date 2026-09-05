import { describe, expect, it } from 'vitest';
import { deriveVarianceIntelligence } from './variance-intelligence.js';

describe('variance intelligence', () => {
  it('groups persisted cases by reason and type with deterministic totals', () => {
    const result = deriveVarianceIntelligence([
      { id: 'a', reason: 'TIMING_DELAY', caseType: 'SETTLEMENT_BANK', amountMinor: 100 },
      { id: 'b', reason: 'TIMING_DELAY', caseType: 'SETTLEMENT_BANK', amountMinor: 50 },
      { id: 'c', reason: 'MISSING_BANK_CREDIT', caseType: 'SETTLEMENT_BANK', amountMinor: 20 },
    ]);
    expect(result.totalVarianceMinor).toBe(170);
    expect(result.groups[0]).toMatchObject({ reason: 'TIMING_DELAY', count: 2, amountMinor: 150, caseIds: ['a', 'b'] });
  });
});
