import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  generateScenario,
  parseCsvDocument,
  scenarioMutationCatalog,
  serializeScenarioToCsvViews,
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

  it.each(scenarioMutationCatalog)('changes operational evidence for %s', (mutation) => {
    const clean = generateScenario({ seed: 42, size: 100 });
    const mutated = generateScenario({ seed: 42, size: 100, mutations: [mutation] });
    expect(mutated.hiddenTruth.expectedRelationships).toEqual(clean.hiddenTruth.expectedRelationships);
    expect(mutated.hiddenTruth.expectedAllocations).toEqual(clean.hiddenTruth.expectedAllocations);
    expect(mutated.operationalRecords).not.toEqual(clean.operationalRecords);
  });

  it('serializes three shuffled CSV views from the same scenario and hidden truth', async () => {
    const scenario = generateScenario({ seed: 42, size: 100, profile: 'adversarial' });
    const views = serializeScenarioToCsvViews(scenario);
    const directory = await mkdtemp(join(tmpdir(), 'anvaya-generator-'));
    await Promise.all([
      writeFile(join(directory, 'merchant_transactions.csv'), views.merchantTransactions),
      writeFile(join(directory, 'settlement_records.csv'), views.settlementRecords),
      writeFile(join(directory, 'bank_statement.csv'), views.bankStatement),
    ]);
    const [merchantCsv, settlementCsv, bankCsv] = await Promise.all([
      readFile(join(directory, 'merchant_transactions.csv'), 'utf8'),
      readFile(join(directory, 'settlement_records.csv'), 'utf8'),
      readFile(join(directory, 'bank_statement.csv'), 'utf8'),
    ]);
    await rm(directory, { recursive: true, force: true });
    const merchants = parseCsvDocument(merchantCsv);
    const settlements = parseCsvDocument(settlementCsv);
    const banks = parseCsvDocument(bankCsv);
    expect(views).toEqual(serializeScenarioToCsvViews(scenario));
    expect(merchants).toHaveLength(100);
    expect(new Set(settlements.map((row) => row.settlement_id))).toEqual(
      new Set(scenario.operationalRecords.settlements.map((settlement) => settlement.id)),
    );
    expect(banks.map((row) => row.bank_entry_id)).toEqual(
      expect.arrayContaining(scenario.hiddenTruth.expectedAllocations.map((allocation) => allocation.bankEntryId)),
    );
    expect(new Set(merchants.map((row) => row.scenario_id))).toEqual(new Set([scenario.hiddenTruth.scenarioId]));
    expect(new Set(settlements.map((row) => row.scenario_id))).toEqual(new Set([scenario.hiddenTruth.scenarioId]));
    expect(new Set(banks.map((row) => row.scenario_id))).toEqual(new Set([scenario.hiddenTruth.scenarioId]));
    const merchant = merchants.find((row) => row.merchant_id === 'merchant-00011');
    const settlement = settlements.find((row) => row.psp_transaction_id === 'psp-00011');
    expect(merchant?.external_ref).toBe(settlement?.transaction_ref);
    expect(settlement?.settlement_id).toBe('settlement-0002');
    expect(merchants.map((row) => row.merchant_id)).not.toEqual(
      scenario.operationalRecords.merchantTransactions.map((record) => record.id),
    );
    expect(banks[0]).toHaveProperty('narration');
    expect(scenario.operationalRecords.bankEntries.every((entry) => entry.narration.length > 0)).toBe(true);
  });

  it('keeps hidden truth out of public demo fixtures', async () => {
    const demoFiles = await readdir('data/demo');
    expect(demoFiles).not.toContain('hidden-ground-truth.json');
  });

  it('keeps canonicalized CSV views stable for the same seed and changes them for another seed', () => {
    const first = serializeScenarioToCsvViews(generateScenario({ seed: 42, size: 100, profile: 'adversarial' }));
    const same = serializeScenarioToCsvViews(generateScenario({ seed: 42, size: 100, profile: 'adversarial' }));
    const different = serializeScenarioToCsvViews(generateScenario({ seed: 73, size: 100, profile: 'adversarial' }));
    const canonicalize = (csv: string) => csv.split('\n').slice(1).sort().join('\n');
    expect(Object.values(first).map(canonicalize)).toEqual(Object.values(same).map(canonicalize));
    expect(Object.values(first).map(canonicalize)).not.toEqual(Object.values(different).map(canonicalize));
  });
});
