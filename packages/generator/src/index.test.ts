import { describe, expect, it } from 'vitest';

import {
  generateScenario,
  scenarioMutationCatalog,
} from './index.js';

describe('synthetic financial world generator', () => {
  it('reproduces operational data and hidden truth for the same seed and config', () => {
    expect(generateScenario({ seed: 42, size: 100, profile: 'clean' })).toEqual(
      generateScenario({ seed: 42, size: 100, profile: 'clean' }),
    );
  });

  it.each([50, 100, 500])('creates the requested merchant batch size (%i)', (size) => {
    const scenario = generateScenario({ seed: 7, size });
    expect(scenario.operationalRecords.merchantTransactions).toHaveLength(size);
    expect(scenario.hiddenTruth.expectedRelationships).toHaveLength(size);
  });

  it('applies composable mutations without changing hidden expected amounts', () => {
    const scenario = generateScenario({
      seed: 42,
      size: 50,
      mutations: ['wrong_amount', 'unattributed_bank_entry', 'settlement_component_integrity_break'],
    });
    expect(scenario.operationalRecords.merchantTransactions[0].amountMinor).not.toBe(
      scenario.operationalRecords.pspTransactions[0].amountMinor,
    );
    expect(scenario.operationalRecords.bankEntries).toHaveLength(6);
    expect(scenario.operationalRecords.settlements[0].statedAmountMinor).toBe(
      scenario.hiddenTruth.expectedAllocations[0].amountMinor + 1,
    );
    expect(scenario.hiddenTruth.expectedReason).toBe('INTEGRITY_FAILURE');
    expect(scenario.hiddenTruth.expectedVariance.amountMinor).toBe(7915);
  });

  it('exposes every required mutation', () => {
    expect(scenarioMutationCatalog).toHaveLength(11);
  });
});
