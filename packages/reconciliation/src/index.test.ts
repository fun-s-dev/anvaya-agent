import { describe, expect, it } from 'vitest';

import { generateScenario } from '@anvaya/generator';

import {
  buildAmbiguityObservation,
  calculateRunLevelLlmBudget,
  computeSettlementIntegrity,
  DEFAULT_TIMING_POLICY,
  financialEffectMinor,
  findAmountDateWindowMatches,
  findExactTransactionSettlementMatches,
  findNormalizedReferenceMatches,
  findSupportedAggregateMatches,
  normalizeReference,
  reconcileDeterministicFastPath,
  resolveTimingStatus,
  runSettlementIntegrityCheck,
  sumComponentFinancialEffects,
  validateDeterministicFastPath,
} from './index.js';

describe('reconciliation deterministic fast path', () => {
  it('validates supported deterministic stages', () => {
    expect(() => validateDeterministicFastPath('settlement_integrity')).not.toThrow();
    expect(() => validateDeterministicFastPath('not-supported')).toThrow(/Unsupported deterministic reconciliation step/i);
  });

  it('computes settlement financial integrity before matching', () => {
    const settlement = { id: 'settlement-001', statedAmountMinor: 1200, componentSetComplete: true };
    const components = [
      { settlementId: 'settlement-001', amountMinor: 700, financialEffectMinor: 700 },
      { settlementId: 'settlement-001', amountMinor: 500, financialEffectMinor: 500 },
    ];

    const result = computeSettlementIntegrity(settlement, components);
    expect(result.status).toBe('OK');
    expect(result.derivedAmountMinor).toBe(1200);
    expect(result.varianceMinor).toBe(0);
    expect(sumComponentFinancialEffects(components)).toBe(1200);
  });

  it('flags integrity failures for inconsistent settlement totals', () => {
    const settlement = { id: 'settlement-002', statedAmountMinor: 1500, componentSetComplete: true };
    const components = [
      { settlementId: 'settlement-002', amountMinor: 700, financialEffectMinor: 700 },
      { settlementId: 'settlement-002', amountMinor: 500, financialEffectMinor: 500 },
    ];

    const result = computeSettlementIntegrity(settlement, components);
    expect(result.status).toBe('INTEGRITY_FAILURE');
    expect(result.reason).toBe('INTEGRITY_FAILURE');
    expect(result.blocked).toBe(true);
  });

  it('matches exact transaction-provider references', () => {
    const merchantTransactions = [
      { id: 'merchant-1', externalRef: 'PAY-0001', amountMinor: 1500, transactionDate: '2026-08-10T00:00:00.000Z' },
    ];
    const pspTransactions = [
      { id: 'psp-1', transactionRef: 'PAY-0001', settlementId: 'settlement-1', amountMinor: 1500, transactionDate: '2026-08-10T00:00:00.000Z' },
    ];

    const matches = findExactTransactionSettlementMatches(merchantTransactions, pspTransactions);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.matchType).toBe('exact_reference');
    expect(matches[0]?.settlementId).toBe('settlement-1');
  });

  it('supports many transactions mapping to one settlement', () => {
    const merchantTransactions = [
      { id: 'TX1', externalRef: 'PAY-400', amountMinor: 400, transactionDate: '2026-08-10T00:00:00.000Z' },
      { id: 'TX2', externalRef: 'PAY-600', amountMinor: 600, transactionDate: '2026-08-10T00:00:00.000Z' },
    ];
    const pspTransactions = [
      { id: 'PSP1', transactionRef: 'PAY-400', settlementId: 'SETTLEMENT-1000', amountMinor: 400, transactionDate: '2026-08-10T00:00:00.000Z' },
      { id: 'PSP2', transactionRef: 'PAY-600', settlementId: 'SETTLEMENT-1000', amountMinor: 600, transactionDate: '2026-08-10T00:00:00.000Z' },
    ];

    const matches = findExactTransactionSettlementMatches(merchantTransactions, pspTransactions);
    expect(matches).toHaveLength(2);
    expect(matches.every((match) => match.settlementId === 'SETTLEMENT-1000')).toBe(true);
  });

  it('matches normalized references across formatting noise', () => {
    const merchantTransactions = [
      { id: 'merchant-1', externalRef: 'pay-001', amountMinor: 2500, transactionDate: '2026-08-11T00:00:00.000Z' },
    ];
    const pspTransactions = [
      { id: 'psp-1', transactionRef: 'PAY 001', settlementId: 'settlement-9', amountMinor: 2500, transactionDate: '2026-08-11T00:00:00.000Z' },
    ];

    const matches = findNormalizedReferenceMatches(merchantTransactions, pspTransactions);
    expect(matches).toHaveLength(1);
    expect(normalizeReference('PAY 001')).toBe('PAY001');
    expect(matches[0]?.matchType).toBe('normalized_reference');
  });

  it('matches using amount and date-window logic', () => {
    const merchantTransactions = [
      { id: 'merchant-1', externalRef: 'PAY-999', amountMinor: 2000, transactionDate: '2026-08-12T08:00:00.000Z' },
    ];
    const pspTransactions = [
      { id: 'psp-1', transactionRef: 'PAY-888', settlementId: 'settlement-12', amountMinor: 2000, transactionDate: '2026-08-13T10:00:00.000Z' },
    ];

    const matches = findAmountDateWindowMatches(merchantTransactions, pspTransactions, 2);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.matchType).toBe('amount_and_date_window');
  });

  it('supports settlement-bank aggregate allocation for one settlement to multiple bank entries', () => {
    const settlements = [{ id: 'settlement-4', statedAmountMinor: 3500, componentSetComplete: true }];
    const bankEntries = [
      { id: 'bank-1', entryRef: 'UTR-4', amountMinor: 1500, narration: 'Settlement credit settlement-4 via bank trace UTR-4', postedAt: '2026-08-13T08:00:00.000Z' },
      { id: 'bank-2', entryRef: 'UTR-5', amountMinor: 2000, narration: 'Settlement credit settlement-4 via bank trace UTR-5', postedAt: '2026-08-13T08:00:00.000Z' },
    ];

    const matches = findSupportedAggregateMatches(settlements, bankEntries);
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(matches.some((match) => match.bankEntryId === 'bank-1')).toBe(true);
    expect(matches.some((match) => match.bankEntryId === 'bank-2')).toBe(true);
  });

  it('does not subtract fee/tax again when net effect is already represented in credit/debit', () => {
    const financialEffect = financialEffectMinor({
      creditMinor: 1000,
      debitMinor: 25,
      amountMinor: 1000,
    });

    expect(financialEffect).toBe(975);
  });

  it('distinguishes pending, ready, and overdue timing states', () => {
    const asOf = '2026-08-14T00:00:00.000Z';
    expect(resolveTimingStatus(asOf, '2026-08-16T12:00:00.000Z', DEFAULT_TIMING_POLICY)).toBe('PENDING');
    expect(resolveTimingStatus(asOf, '2026-08-14T10:00:00.000Z', DEFAULT_TIMING_POLICY)).toBe('READY');
    expect(resolveTimingStatus(asOf, '2026-08-10T00:00:00.000Z', { ...DEFAULT_TIMING_POLICY, bankGraceDays: 2 })).toBe('OVERDUE');

    const result = reconcileDeterministicFastPath({
      settlements: [{ id: 'SET-1', statedAmountMinor: 500, componentSetComplete: true }],
      settlementComponents: [{ settlementId: 'SET-1', amountMinor: 500, financialEffectMinor: 500 }],
      merchantTransactions: [],
      pspTransactions: [],
      bankEntries: [{ id: 'BANK-OVERDUE', entryRef: 'UTR-OVERDUE', amountMinor: 500, postedAt: '2026-08-10T00:00:00.000Z' }],
      asOf,
    });

    expect(result.timingStatus.some((entry) => entry.status === 'OVERDUE')).toBe(true);
    expect(result.overdueBankEntryIds).toContain('BANK-OVERDUE');
  });

  it('emits a structured ambiguity observation when a case is genuinely ambiguous', () => {
    const observation = buildAmbiguityObservation({
      caseId: 'CASE-17',
      caseType: 'TRANSACTION_SETTLEMENT',
      reason: 'AMBIGUOUS_REFERENCE',
      evidence: { transactionIds: ['merchant-1', 'merchant-2'] },
    });

    expect(observation.case_id).toBe('CASE-17');
    expect(observation.reason).toBe('AMBIGUOUS_REFERENCE');
    expect(observation.available_actions).toContain('ESCALATE');
  });

  it('blocks downstream matching and agent calls when settlement integrity fails', () => {
    const result = reconcileDeterministicFastPath({
      settlements: [{ id: 'BAD-SET', statedAmountMinor: 1000, componentSetComplete: true }],
      settlementComponents: [
        { settlementId: 'BAD-SET', amountMinor: 400, financialEffectMinor: 400 },
        { settlementId: 'BAD-SET', amountMinor: 500, financialEffectMinor: 500 },
      ],
      merchantTransactions: [{ id: 'TXA', externalRef: 'PAY-BAD', amountMinor: 400, transactionDate: '2026-08-10T00:00:00.000Z' }],
      pspTransactions: [{ id: 'PSP-A', transactionRef: 'PAY-BAD', settlementId: 'BAD-SET', amountMinor: 400, transactionDate: '2026-08-10T00:00:00.000Z' }],
      bankEntries: [{ id: 'BANK-A', entryRef: 'UTR-BAD', amountMinor: 1000, narration: 'Settlement credit BAD-SET via UTR-BAD', postedAt: '2026-08-12T00:00:00.000Z' }],
    });

    expect(result.reason).toBe('INTEGRITY_FAILURE');
    expect(result.blockedSettlementIds).toContain('BAD-SET');
    expect(result.integrity[0]?.status).toBe('INTEGRITY_FAILURE');
    expect(result.exactReferenceMatches).toHaveLength(0);
    expect(result.aggregateMatches).toHaveLength(0);
    expect(result.ambiguity.every((item) => item.llmCallCount === 0)).toBe(true);
    expect(result.conservationStatus).toBe('BLOCKED');
    expect(result.blockedAmountMinor).toBe(1000);
  });

  it('exposes unresolved value and conservation status without silently hiding it', () => {
    const result = reconcileDeterministicFastPath({
      settlements: [{ id: 'SET-1', statedAmountMinor: 1000, componentSetComplete: true }],
      settlementComponents: [{ settlementId: 'SET-1', amountMinor: 1000, financialEffectMinor: 1000 }],
      merchantTransactions: [],
      pspTransactions: [],
      bankEntries: [{ id: 'BANK-UNALLOCATED', entryRef: 'UTR-UNALLOCATED', amountMinor: 2500, narration: 'Unallocated bank cash', postedAt: '2026-08-12T00:00:00.000Z' }],
    });

    expect(result.allocatedAmountMinor).toBe(0);
    expect(result.unresolvedAmountMinor).toBe(2500);
    expect(result.conservationStatus).toBe('UNRESOLVED');
  });

  it('keeps clean generated scenarios deterministic and passes the fast path', () => {
    const scenario = generateScenario({ seed: 42, size: 20, profile: 'clean' });
    const result = reconcileDeterministicFastPath({
      settlements: scenario.operationalRecords.settlements,
      settlementComponents: scenario.operationalRecords.settlementComponents,
      merchantTransactions: scenario.operationalRecords.merchantTransactions,
      pspTransactions: scenario.operationalRecords.pspTransactions,
      bankEntries: scenario.operationalRecords.bankEntries,
    });

    expect(result.integrity.every((entry) => entry.status === 'OK')).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.conservationStatus).toBe('OK');
    expect(calculateRunLevelLlmBudget(20)).toBe(5);
  });

  it('detects settlement integrity failures and blocks downstream closure in generated scenarios', () => {
    const scenario = generateScenario({ seed: 42, size: 50, mutations: ['settlement_component_integrity_break'] });
    const integrity = runSettlementIntegrityCheck(
      scenario.operationalRecords.settlements,
      scenario.operationalRecords.settlementComponents,
    );

    expect(integrity.some((result) => result.status === 'INTEGRITY_FAILURE')).toBe(true);
    expect(scenario.hiddenTruth.expectedReason).toBe('INTEGRITY_FAILURE');

    const result = reconcileDeterministicFastPath({
      settlements: scenario.operationalRecords.settlements,
      settlementComponents: scenario.operationalRecords.settlementComponents,
      merchantTransactions: scenario.operationalRecords.merchantTransactions,
      pspTransactions: scenario.operationalRecords.pspTransactions,
      bankEntries: scenario.operationalRecords.bankEntries,
    });

    const blockedSet = new Set(result.blockedSettlementIds);
    expect(result.reason).toBe('INTEGRITY_FAILURE');
    expect(result.blockedSettlementIds.length).toBeGreaterThan(0);
    expect(result.exactReferenceMatches.every((match) => !blockedSet.has(match.settlementId ?? ''))).toBe(true);
    expect(result.aggregateMatches.every((match) => !blockedSet.has(match.settlementId ?? ''))).toBe(true);
  });
});
