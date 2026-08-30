import { z } from 'zod';

export const scenarioMutationCatalog = [
  'wrong_amount',
  'missing_settlement',
  'reference_truncation',
  'reference_prefix_change',
  'ambiguous_reference',
  'conflicting_candidate_set',
  'bank_timing_delay',
  'unattributed_bank_entry',
  'duplicate_import',
  'unsupported_adjustment_reference',
  'settlement_component_integrity_break',
] as const;

export type ScenarioMutation = (typeof scenarioMutationCatalog)[number];
export type ScenarioProfile = 'clean' | 'adversarial';

const currencySchema = z.literal('INR');
const moneySchema = z.number().int();

export const MerchantTransactionSchema = z.object({
  id: z.string(),
  provider: z.literal('mock-provider'),
  sourceType: z.literal('merchant'),
  sourceRecordId: z.string(),
  externalRef: z.string(),
  amountMinor: moneySchema,
  currency: currencySchema,
  transactionDate: z.string(),
  status: z.literal('captured'),
});

export const PspTransactionSchema = z.object({
  id: z.string(),
  provider: z.literal('mock-provider'),
  sourceType: z.literal('psp'),
  sourceRecordId: z.string(),
  transactionRef: z.string(),
  settlementId: z.string(),
  amountMinor: moneySchema,
  currency: currencySchema,
  transactionDate: z.string(),
});

export const SettlementComponentSchema = z.object({
  id: z.string(),
  settlementId: z.string(),
  provider: z.literal('mock-provider'),
  sourceType: z.literal('psp'),
  sourceRecordId: z.string(),
  componentType: z.enum(['payment', 'fee', 'tax', 'adjustment']),
  amountMinor: moneySchema,
  financialEffectMinor: moneySchema,
  currency: currencySchema,
});

export const SettlementEntitySchema = z.object({
  id: z.string(),
  provider: z.literal('mock-provider'),
  sourceType: z.literal('psp'),
  sourceRecordId: z.string(),
  externalSettlementId: z.string(),
  statedAmountMinor: moneySchema,
  currency: currencySchema,
  settlementDate: z.string(),
  componentIds: z.array(z.string()),
  componentSetComplete: z.boolean(),
});

export const BankEntrySchema = z.object({
  id: z.string(),
  provider: z.literal('mock-provider'),
  sourceType: z.literal('bank'),
  sourceRecordId: z.string(),
  entryRef: z.string(),
  amountMinor: moneySchema,
  currency: currencySchema,
  postedAt: z.string(),
  direction: z.literal('credit'),
});

export type MerchantTransaction = z.infer<typeof MerchantTransactionSchema>;
export type PspTransaction = z.infer<typeof PspTransactionSchema>;
export type SettlementComponent = z.infer<typeof SettlementComponentSchema>;
export type SettlementEntity = z.infer<typeof SettlementEntitySchema>;
export type BankEntry = z.infer<typeof BankEntrySchema>;

export type ExpectedRelationship = {
  transactionId: string;
  pspTransactionId: string;
  settlementId: string | null;
  bankEntryIds: string[];
};

export type ExpectedAllocation = {
  settlementId: string;
  bankEntryId: string;
  amountMinor: number;
  currency: 'INR';
};

export type HiddenTruth = {
  scenarioId: string;
  expectedRelationships: ExpectedRelationship[];
  expectedAllocations: ExpectedAllocation[];
  expectedFinalState: 'VERIFIED' | 'PENDING' | 'ESCALATED';
  expectedReason: string;
  expectedVariance: { amountMinor: number; currency: 'INR' };
  expectedEvidenceSourceLinks: Array<{
    entityId: string;
    sourceType: 'merchant' | 'psp' | 'bank';
    sourceRecordId: string;
  }>;
  mutations: ScenarioMutation[];
};

export type OperationalRecords = {
  merchantTransactions: MerchantTransaction[];
  pspTransactions: PspTransaction[];
  settlementComponents: SettlementComponent[];
  settlements: SettlementEntity[];
  bankEntries: BankEntry[];
};

export type GeneratedScenario = {
  config: { seed: number; size: number; profile: ScenarioProfile; mutations: ScenarioMutation[] };
  operationalRecords: OperationalRecords;
  hiddenTruth: HiddenTruth;
};

export type GenerateScenarioOptions = {
  seed: number;
  size: number;
  profile?: ScenarioProfile;
  mutations?: ScenarioMutation[];
};

export type ScenarioCsvViews = {
  merchantTransactions: string;
  settlementRecords: string;
  bankStatement: string;
};

class SeededRandom {
  private state: number;

  public constructor(seed: number) {
    this.state = (seed >>> 0) || 1;
  }

  public nextInt(maxExclusive: number): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state % maxExclusive;
  }

  public shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = this.nextInt(index + 1);
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }
}

function isoDate(day: number): string {
  return `2026-08-${String(day).padStart(2, '0')}T10:00:00.000Z`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function applyWrongAmount(records: OperationalRecords): void {
  const record = records.merchantTransactions[0];
  record.amountMinor += 137;
}

function applyMissingSettlement(records: OperationalRecords, truth: HiddenTruth): void {
  const settlementId = truth.expectedRelationships[1]?.settlementId;
  if (!settlementId) return;
  records.settlements = records.settlements.filter((item) => item.id !== settlementId);
  records.settlementComponents = records.settlementComponents.filter(
    (item) => item.settlementId !== settlementId,
  );
}

function applyReferenceTruncation(records: OperationalRecords): void {
  const record = records.pspTransactions[0];
  record.transactionRef = record.transactionRef.slice(0, -4);
}

function applyReferencePrefixChange(records: OperationalRecords): void {
  records.bankEntries[0].entryRef = `CREDIT-${records.bankEntries[0].entryRef}`;
}

function applyAmbiguousReference(records: OperationalRecords): void {
  if (records.pspTransactions.length > 1) {
    records.pspTransactions[1].transactionRef = records.pspTransactions[0].transactionRef;
  }
}

function applyConflictingCandidateSet(records: OperationalRecords): void {
  if (records.bankEntries.length > 1) {
    records.bankEntries[1].entryRef = records.bankEntries[0].entryRef;
    records.bankEntries[1].amountMinor = records.bankEntries[0].amountMinor + 1;
  }
}

function applyBankTimingDelay(records: OperationalRecords): void {
  const delayed = records.bankEntries[0];
  delayed.postedAt = '2026-09-05T10:00:00.000Z';
}

function applyUnattributedBankEntry(records: OperationalRecords): void {
  records.bankEntries.push({
    id: 'bank-unattributed-001',
    provider: 'mock-provider',
    sourceType: 'bank',
    sourceRecordId: 'bank-unattributed-001',
    entryRef: 'UNATTRIBUTED-001',
    amountMinor: 7777,
    currency: 'INR',
    postedAt: isoDate(28),
    direction: 'credit',
  });
}

function applyDuplicateImport(records: OperationalRecords): void {
  const duplicate = clone(records.merchantTransactions[0]);
  duplicate.id = `${duplicate.id}-duplicate-import`;
  records.merchantTransactions.push(duplicate);
}

function applyUnsupportedAdjustmentReference(records: OperationalRecords): void {
  const settlement = records.settlements[0];
  const component: SettlementComponent = {
    id: 'component-unsupported-adjustment-001',
    settlementId: settlement.id,
    provider: 'mock-provider',
    sourceType: 'psp',
    sourceRecordId: 'component-unsupported-adjustment-001',
    componentType: 'adjustment',
    amountMinor: 25,
    financialEffectMinor: 25,
    currency: 'INR',
  };
  records.settlementComponents.push(component);
  settlement.componentIds.push(component.id);
}

function applySettlementComponentIntegrityBreak(records: OperationalRecords): void {
  const settlement = records.settlements[0];
  settlement.statedAmountMinor += 1;
}

const mutationHandlers: Record<
  ScenarioMutation,
  (records: OperationalRecords, truth: HiddenTruth) => void
> = {
  wrong_amount: applyWrongAmount,
  missing_settlement: applyMissingSettlement,
  reference_truncation: applyReferenceTruncation,
  reference_prefix_change: applyReferencePrefixChange,
  ambiguous_reference: applyAmbiguousReference,
  conflicting_candidate_set: applyConflictingCandidateSet,
  bank_timing_delay: applyBankTimingDelay,
  unattributed_bank_entry: applyUnattributedBankEntry,
  duplicate_import: applyDuplicateImport,
  unsupported_adjustment_reference: applyUnsupportedAdjustmentReference,
  settlement_component_integrity_break: applySettlementComponentIntegrityBreak,
};

function reasonFor(mutations: ScenarioMutation[]): string {
  if (mutations.includes('settlement_component_integrity_break')) return 'INTEGRITY_FAILURE';
  if (mutations.includes('unattributed_bank_entry')) return 'UNATTRIBUTED_BANK_ENTRY';
  if (mutations.includes('bank_timing_delay')) return 'TIMING_DELAY';
  if (mutations.includes('missing_settlement')) return 'MISSING_SETTLEMENT';
  if (mutations.some((mutation) => mutation.includes('reference') || mutation.includes('candidate'))) {
    return 'AMBIGUOUS_REFERENCE';
  }
  if (mutations.includes('wrong_amount')) return 'AMOUNT_MISMATCH';
  return 'CLEAN';
}

function varianceFor(mutations: ScenarioMutation[]): number {
  let variance = 0;
  if (mutations.includes('wrong_amount')) variance += 137;
  if (mutations.includes('settlement_component_integrity_break')) variance += 1;
  if (mutations.includes('unattributed_bank_entry')) variance += 7777;
  return variance;
}

export function applyScenarioMutations(
  records: OperationalRecords,
  truth: HiddenTruth,
  mutations: readonly ScenarioMutation[],
): void {
  for (const mutation of mutations) mutationHandlers[mutation](records, truth);
}

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvDocument(headers: string[], rows: Array<Array<string | number | boolean>>): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

export function serializeScenarioToCsvViews(scenario: GeneratedScenario): ScenarioCsvViews {
  const { config, operationalRecords } = scenario;
  const merchantRows = new SeededRandom(config.seed ^ 0x13579bdf).shuffle(
    operationalRecords.merchantTransactions,
  );
  const settlementRows = new SeededRandom(config.seed ^ 0x2468ace0).shuffle(
    operationalRecords.settlementComponents.flatMap((component) => {
      const settlement = operationalRecords.settlements.find((item) => item.id === component.settlementId);
      return settlement
        ? [[
            config.seed, config.profile, `${config.seed}-${config.size}-${config.profile}`,
            settlement.id, settlement.sourceRecordId, settlement.externalSettlementId,
            settlement.statedAmountMinor, settlement.currency, settlement.settlementDate,
            component.id, component.componentType, component.amountMinor,
            component.financialEffectMinor, settlement.componentSetComplete,
          ]]
        : [];
    }),
  );
  const bankRows = new SeededRandom(config.seed ^ 0xabcdef01).shuffle(
    operationalRecords.bankEntries.map((entry) => [
      `${config.seed}-${config.size}-${config.profile}`, config.profile, entry.id,
      entry.sourceRecordId, entry.entryRef, entry.amountMinor, entry.currency,
      entry.postedAt, entry.direction,
    ]),
  );

  return {
    merchantTransactions: csvDocument(
      ['scenario_id', 'profile', 'merchant_id', 'source_record_id', 'external_ref', 'amount_minor', 'currency', 'transaction_date', 'status'],
      merchantRows.map((record) => [
        `${config.seed}-${config.size}-${config.profile}`, config.profile, record.id,
        record.sourceRecordId, record.externalRef, record.amountMinor, record.currency,
        record.transactionDate, record.status,
      ]),
    ),
    settlementRecords: csvDocument(
      ['seed', 'profile', 'scenario_id', 'settlement_id', 'settlement_source_record_id', 'external_settlement_id', 'stated_amount_minor', 'currency', 'settlement_date', 'component_id', 'component_type', 'component_amount_minor', 'financial_effect_minor', 'component_set_complete'],
      settlementRows,
    ),
    bankStatement: csvDocument(
      ['scenario_id', 'profile', 'bank_entry_id', 'source_record_id', 'entry_ref', 'amount_minor', 'currency', 'posted_at', 'direction'],
      bankRows,
    ),
  };
}

export function generateScenario(options: GenerateScenarioOptions): GeneratedScenario {
  if (!Number.isInteger(options.seed)) throw new Error('seed must be an integer.');
  if (!Number.isInteger(options.size) || options.size < 1) throw new Error('size must be a positive integer.');
  const profile = options.profile ?? 'clean';
  const random = new SeededRandom(options.seed);
  const mutations = [...(options.mutations ?? (profile === 'adversarial'
    ? scenarioMutationCatalog.slice(0, Math.min(4, Math.max(1, Math.floor(options.size / 50))))
    : []))];
  const settlements: SettlementEntity[] = [];
  const components: SettlementComponent[] = [];
  const pspTransactions: PspTransaction[] = [];
  const merchantTransactions: MerchantTransaction[] = [];
  const bankEntries: BankEntry[] = [];
  const expectedRelationships: ExpectedRelationship[] = [];
  const expectedAllocations: ExpectedAllocation[] = [];

  const settlementCount = Math.max(1, Math.ceil(options.size / 10));
  for (let settlementIndex = 0; settlementIndex < settlementCount; settlementIndex += 1) {
    const settlementId = `settlement-${String(settlementIndex + 1).padStart(4, '0')}`;
    const componentIds: string[] = [];
    let statedAmountMinor = 0;
    for (let componentIndex = 0; componentIndex < 10 && settlementIndex * 10 + componentIndex < options.size; componentIndex += 1) {
      const index = settlementIndex * 10 + componentIndex;
      const amountMinor = 10000 + random.nextInt(90000);
      const componentId = `component-${String(index + 1).padStart(5, '0')}`;
      componentIds.push(componentId);
      statedAmountMinor += amountMinor;
      components.push({
        id: componentId,
        settlementId,
        provider: 'mock-provider',
        sourceType: 'psp',
        sourceRecordId: componentId,
        componentType: 'payment',
        amountMinor,
        financialEffectMinor: amountMinor,
        currency: 'INR',
      });
    }
    settlements.push({
      id: settlementId,
      provider: 'mock-provider',
      sourceType: 'psp',
      sourceRecordId: settlementId,
      externalSettlementId: `set_${options.seed}_${settlementIndex + 1}`,
      statedAmountMinor,
      currency: 'INR',
      settlementDate: isoDate(10 + settlementIndex),
      componentIds,
      componentSetComplete: true,
    });
    const bankId = `bank-${String(settlementIndex + 1).padStart(4, '0')}`;
    bankEntries.push({
      id: bankId,
      provider: 'mock-provider',
      sourceType: 'bank',
      sourceRecordId: bankId,
      entryRef: `UTR-${options.seed}-${settlementIndex + 1}`,
      amountMinor: statedAmountMinor,
      currency: 'INR',
      postedAt: isoDate(12 + settlementIndex),
      direction: 'credit',
    });
    expectedAllocations.push({ settlementId, bankEntryId: bankId, amountMinor: statedAmountMinor, currency: 'INR' });
  }
  for (let index = 0; index < options.size; index += 1) {
    const settlementIndex = Math.floor(index / 10);
    const settlementId = settlements[settlementIndex].id;
    const transactionId = `merchant-${String(index + 1).padStart(5, '0')}`;
    const pspId = `psp-${String(index + 1).padStart(5, '0')}`;
    const amountMinor = components[index].amountMinor;
    const reference = `PAY-${options.seed}-${String(index + 1).padStart(5, '0')}`;
    merchantTransactions.push({
      id: transactionId, provider: 'mock-provider', sourceType: 'merchant', sourceRecordId: transactionId,
      externalRef: reference, amountMinor, currency: 'INR', transactionDate: isoDate(5 + (index % 3)), status: 'captured',
    });
    pspTransactions.push({
      id: pspId, provider: 'mock-provider', sourceType: 'psp', sourceRecordId: pspId,
      transactionRef: reference, settlementId, amountMinor, currency: 'INR', transactionDate: isoDate(5 + (index % 3)),
    });
    expectedRelationships.push({ transactionId, pspTransactionId: pspId, settlementId, bankEntryIds: [bankEntries[settlementIndex].id] });
  }
  const scenarioId = `scenario-${options.seed}-${options.size}-${profile}`;
  const hiddenTruth: HiddenTruth = {
    scenarioId,
    expectedRelationships,
    expectedAllocations,
    expectedFinalState: mutations.length === 0 ? 'VERIFIED' : 'ESCALATED',
    expectedReason: reasonFor(mutations),
    expectedVariance: { amountMinor: varianceFor(mutations), currency: 'INR' },
    expectedEvidenceSourceLinks: [
      ...merchantTransactions.map((record) => ({ entityId: record.id, sourceType: 'merchant' as const, sourceRecordId: record.sourceRecordId })),
      ...settlements.map((record) => ({ entityId: record.id, sourceType: 'psp' as const, sourceRecordId: record.sourceRecordId })),
      ...bankEntries.map((record) => ({ entityId: record.id, sourceType: 'bank' as const, sourceRecordId: record.sourceRecordId })),
    ],
    mutations,
  };
  const operationalRecords: OperationalRecords = { merchantTransactions, pspTransactions, settlementComponents: components, settlements, bankEntries };
  applyScenarioMutations(operationalRecords, hiddenTruth, mutations);
  return { config: { seed: options.seed, size: options.size, profile, mutations }, operationalRecords, hiddenTruth };
}

export function describeScenarioConfig(seed: number, size: number) {
  return { seed, size, publicMode: 'synthetic' as const };
}
