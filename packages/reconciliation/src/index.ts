import { z } from 'zod';

export const deterministicFastPath = [
  'settlement_integrity',
  'exact_reference',
  'normalized_reference',
  'amount_and_date_window',
  'aggregate_allocation',
  'timing_policy',
] as const;

export const reconciliationReasonCodes = [
  'MISSING_SETTLEMENT',
  'MISSING_BANK_CREDIT',
  'TIMING_DELAY',
  'AMOUNT_MISMATCH',
  'AMBIGUOUS_REFERENCE',
  'CONFLICTING_EVIDENCE',
  'INTEGRITY_FAILURE',
  'UNATTRIBUTED_BANK_ENTRY',
] as const;

export const agentActionCodes = [
  'RUN_INTEGRITY_CHECK',
  'MATCH_EXACT',
  'MATCH_COMPOSITE',
  'MATCH_AGGREGATE',
  'CHECK_TIMING',
  'CALCULATE_VARIANCE',
  'INTERPRET_EVIDENCE',
  'VALIDATE_CANDIDATE',
  'ESCALATE',
] as const;

export const reconciliationCaseStates = ['OPEN', 'INVESTIGATING', 'PENDING', 'RESOLVED', 'ESCALATED'] as const;

export const ambiguityObservationSchema = z.object({
  case_id: z.string().min(1),
  case_type: z.enum(['TRANSACTION_SETTLEMENT', 'SETTLEMENT_BANK']),
  state: z.enum(reconciliationCaseStates),
  reason: z.enum(reconciliationReasonCodes),
  action_count: z.number().int().nonnegative(),
  llm_call_count: z.number().int().nonnegative(),
  available_actions: z.array(z.enum(agentActionCodes)).default([]),
  evidence: z.record(z.unknown()).default({}),
});

export type DeterministicFastPathStep = (typeof deterministicFastPath)[number];
export type ReconciliationReasonCode = (typeof reconciliationReasonCodes)[number];
export type AgentActionCode = (typeof agentActionCodes)[number];
export type ReconciliationCaseState = (typeof reconciliationCaseStates)[number];
export type AmbiguityObservation = z.infer<typeof ambiguityObservationSchema>;

export type SettlementComponentLike = {
  id?: string;
  settlementId: string;
  currency?: string;
  amountMinor?: number;
  financialEffectMinor?: number;
  creditMinor?: number;
  debitMinor?: number;
  componentType?: string;
};

export type SettlementLike = {
  id: string;
  settlementDate?: string;
  sourceRecordId?: string;
  externalSettlementId?: string;
  statedAmountMinor?: number;
  currency?: string;
  componentSetComplete?: boolean;
  componentIds?: string[];
};

export type MerchantTransactionLike = {
  id: string;
  externalRef?: string;
  amountMinor: number;
  currency?: string;
  transactionDate?: string;
  sourceRecordId?: string;
  settlementId?: string;
};

export type PspTransactionLike = {
  id: string;
  transactionRef?: string;
  settlementId?: string;
  amountMinor: number;
  currency?: string;
  transactionDate?: string;
};

export type BankEntryLike = {
  id: string;
  entryRef?: string;
  amountMinor: number;
  currency?: string;
  postedAt?: string;
  narration?: string;
  direction?: 'credit' | 'debit';
};

export type TimingPolicy = {
  asOf: string;
  settlementGraceDays?: number;
  bankGraceDays?: number;
  bankWindowDays?: number;
};

export type SettlementIntegrityResult = {
  settlementId: string;
  statedAmountMinor: number | null;
  derivedAmountMinor: number;
  varianceMinor: number;
  componentCount: number;
  componentSetComplete: boolean;
  status: 'OK' | 'INTEGRITY_FAILURE';
  reason?: ReconciliationReasonCode;
  blocked: boolean;
};

export type ReferenceMatch = {
  matchType: 'exact_reference' | 'normalized_reference' | 'amount_and_date_window' | 'aggregate_allocation';
  transactionId?: string;
  settlementId?: string;
  pspTransactionId?: string;
  bankEntryId?: string;
  amountMinor: number;
  reference: string;
  score: number;
};

export type IntentionObservation = {
  caseId: string;
  caseType: 'TRANSACTION_SETTLEMENT' | 'SETTLEMENT_BANK';
  state: ReconciliationCaseState;
  reason: ReconciliationReasonCode;
  actionCount: number;
  llmCallCount: number;
  availableActions: AgentActionCode[];
  evidence: Record<string, unknown>;
};

export const DEFAULT_TIMING_POLICY: TimingPolicy = {
  asOf: new Date().toISOString(),
  settlementGraceDays: 2,
  bankGraceDays: 2,
  bankWindowDays: 2,
};

export const MAX_ACTIONS_PER_CASE = 6;

export function validateDeterministicFastPath(step: string): void {
  if (!deterministicFastPath.includes(step as DeterministicFastPathStep)) {
    throw new Error(`Unsupported deterministic reconciliation step: ${step}`);
  }
}

export function explainFastPath(): string[] {
  return [...deterministicFastPath];
}

export function normalizeReference(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function financialEffectMinor(input: {
  amountMinor?: number;
  financialEffectMinor?: number;
  creditMinor?: number;
  debitMinor?: number;
}): number {
  if (Number.isInteger(input.financialEffectMinor)) {
    return input.financialEffectMinor as number;
  }

  if (Number.isInteger(input.creditMinor) || Number.isInteger(input.debitMinor)) {
    return (input.creditMinor ?? 0) - (input.debitMinor ?? 0);
  }

  if (Number.isInteger(input.amountMinor)) {
    return input.amountMinor as number;
  }

  return 0;
}

export function sumComponentFinancialEffects(components: SettlementComponentLike[]): number {
  return components.reduce((total, component) => total + financialEffectMinor(component), 0);
}

export function computeSettlementIntegrity(
  settlement: SettlementLike,
  components: SettlementComponentLike[],
): SettlementIntegrityResult {
  const relevantComponents = components.filter((component) => component.settlementId === settlement.id);
  const derivedAmountMinor = sumComponentFinancialEffects(relevantComponents);
  const componentSetComplete = settlement.componentSetComplete ?? true;
  const statedAmountMinor = componentSetComplete ? (settlement.statedAmountMinor ?? null) : null;
  const varianceMinor = statedAmountMinor === null ? 0 : derivedAmountMinor - statedAmountMinor;
  const status = statedAmountMinor === null || varianceMinor === 0 ? 'OK' : 'INTEGRITY_FAILURE';

  return {
    settlementId: settlement.id,
    statedAmountMinor,
    derivedAmountMinor,
    varianceMinor,
    componentCount: relevantComponents.length,
    componentSetComplete,
    status,
    reason: status === 'INTEGRITY_FAILURE' ? 'INTEGRITY_FAILURE' : undefined,
    blocked: status === 'INTEGRITY_FAILURE',
  };
}

export function runSettlementIntegrityCheck(
  settlements: SettlementLike[],
  components: SettlementComponentLike[],
): SettlementIntegrityResult[] {
  return settlements.map((settlement) => computeSettlementIntegrity(settlement, components));
}

export function findExactTransactionSettlementMatches(
  transactions: MerchantTransactionLike[],
  pspTransactions: PspTransactionLike[],
): ReferenceMatch[] {
  const matches: ReferenceMatch[] = [];
  const pspByRef = new Map<string, PspTransactionLike[]>();

  for (const item of pspTransactions) {
    const ref = normalizeReference(item.transactionRef);
    const bucket = pspByRef.get(ref) ?? [];
    bucket.push(item);
    pspByRef.set(ref, bucket);
  }

  for (const transaction of transactions) {
    const ref = normalizeReference(transaction.externalRef);
    const candidates = pspByRef.get(ref) ?? [];
    for (const candidate of candidates) {
      matches.push({
        matchType: 'exact_reference',
        transactionId: transaction.id,
        pspTransactionId: candidate.id,
        settlementId: candidate.settlementId,
        amountMinor: transaction.amountMinor,
        reference: transaction.externalRef ?? '',
        score: 1,
      });
    }
  }

  return matches;
}

export function findNormalizedReferenceMatches(
  transactions: MerchantTransactionLike[],
  pspTransactions: PspTransactionLike[],
): ReferenceMatch[] {
  const matches: ReferenceMatch[] = [];
  const referenceMap = new Map<string, PspTransactionLike[]>();

  for (const item of pspTransactions) {
    const ref = normalizeReference(item.transactionRef);
    if (!ref) continue;
    const bucket = referenceMap.get(ref) ?? [];
    bucket.push(item);
    referenceMap.set(ref, bucket);
  }

  for (const transaction of transactions) {
    const ref = normalizeReference(transaction.externalRef);
    if (!ref) continue;
    const candidates = referenceMap.get(ref) ?? [];
    for (const candidate of candidates) {
      matches.push({
        matchType: 'normalized_reference',
        transactionId: transaction.id,
        pspTransactionId: candidate.id,
        settlementId: candidate.settlementId,
        amountMinor: transaction.amountMinor,
        reference: ref,
        score: 0.8,
      });
    }
  }

  return matches;
}

export function findAmountDateWindowMatches(
  transactions: MerchantTransactionLike[],
  pspTransactions: PspTransactionLike[],
  toleranceDays = 2,
): ReferenceMatch[] {
  const matches: ReferenceMatch[] = [];

  for (const transaction of transactions) {
    const tDate = transaction.transactionDate ? new Date(transaction.transactionDate).getTime() : Number.NaN;
    if (!Number.isFinite(tDate)) continue;

    for (const pspTransaction of pspTransactions) {
      if (transaction.amountMinor !== pspTransaction.amountMinor) continue;
      const pDate = pspTransaction.transactionDate ? new Date(pspTransaction.transactionDate).getTime() : Number.NaN;
      if (!Number.isFinite(pDate)) continue;
      const diffDays = Math.abs((pDate - tDate) / 86400000);
      if (diffDays <= toleranceDays) {
        matches.push({
          matchType: 'amount_and_date_window',
          transactionId: transaction.id,
          pspTransactionId: pspTransaction.id,
          settlementId: pspTransaction.settlementId,
          amountMinor: transaction.amountMinor,
          reference: `${transaction.externalRef ?? ''}|${pspTransaction.transactionRef ?? ''}`,
          score: 0.6,
        });
      }
    }
  }

  return matches;
}

export function findSupportedAggregateMatches(
  settlements: SettlementLike[],
  bankEntries: BankEntryLike[],
): ReferenceMatch[] {
  const matches: ReferenceMatch[] = [];

  for (const settlement of settlements) {
    const settlementRef = normalizeReference(settlement.externalSettlementId ?? settlement.id);
    if (!settlementRef) continue;

    for (const bankEntry of bankEntries) {
      const entryRef = normalizeReference(bankEntry.entryRef);
      const narration = normalizeReference(bankEntry.narration ?? '');
      const isTraceMatch = entryRef.includes(settlementRef) || narration.includes(settlementRef);
      const amountMatches = settlement.statedAmountMinor !== undefined && bankEntry.amountMinor === settlement.statedAmountMinor;
      if (isTraceMatch || amountMatches) {
        matches.push({
          matchType: 'aggregate_allocation',
          settlementId: settlement.id,
          bankEntryId: bankEntry.id,
          amountMinor: bankEntry.amountMinor,
          reference: settlementRef,
          score: 0.7,
        });
      }
    }
  }

  return matches;
}

export function resolveTimingStatus(
  asOf: string,
  postedAt: string | undefined,
  policy: TimingPolicy = DEFAULT_TIMING_POLICY,
): 'TIMING_DELAY' | 'READY' {
  if (!postedAt) return 'TIMING_DELAY';
  const asOfTime = new Date(asOf).getTime();
  const postedTime = new Date(postedAt).getTime();
  if (Number.isNaN(asOfTime) || Number.isNaN(postedTime)) return 'TIMING_DELAY';
  const windowMs = (policy.bankGraceDays ?? 2) * 24 * 60 * 60 * 1000;
  if (postedTime > asOfTime + windowMs) return 'TIMING_DELAY';
  return 'READY';
}

export function buildAmbiguityObservation(input: {
  caseId: string;
  caseType: 'TRANSACTION_SETTLEMENT' | 'SETTLEMENT_BANK';
  reason: ReconciliationReasonCode;
  actionCount?: number;
  llmCallCount?: number;
  availableActions?: AgentActionCode[];
  evidence?: Record<string, unknown>;
}): AmbiguityObservation {
  const observation = ambiguityObservationSchema.parse({
    case_id: input.caseId,
    case_type: input.caseType,
    state: 'INVESTIGATING',
    reason: input.reason,
    action_count: input.actionCount ?? 0,
    llm_call_count: input.llmCallCount ?? 0,
    available_actions: input.availableActions ?? ['MATCH_COMPOSITE', 'INTERPRET_EVIDENCE', 'ESCALATE'],
    evidence: input.evidence ?? {},
  });

  return observation;
}

export function evaluateUnattributedBankEntries(
  settlements: SettlementLike[],
  bankEntries: BankEntryLike[],
  asOf: string,
): { unattributed: BankEntryLike[]; reason: ReconciliationReasonCode | null } {
  const settlementRefs = settlements.flatMap((settlement) => [
    normalizeReference(settlement.id),
    normalizeReference(settlement.externalSettlementId),
    normalizeReference(settlement.sourceRecordId),
  ]).filter(Boolean);

  const attributed = new Set<string>();
  for (const bankEntry of bankEntries) {
    const refs = [normalizeReference(bankEntry.entryRef), normalizeReference(bankEntry.narration ?? '')];
    const hasSettlementReference = settlementRefs.some((settlementRef) => {
      return refs.some((ref) => ref.includes(settlementRef) && settlementRef.length > 0);
    });
    if (hasSettlementReference) {
      attributed.add(bankEntry.id);
    }
  }

  const unattributed = bankEntries.filter((entry) => !attributed.has(entry.id));
  const reason = unattributed.length > 0 ? 'UNATTRIBUTED_BANK_ENTRY' : null;
  for (const entry of unattributed) {
    if (resolveTimingStatus(asOf, entry.postedAt, DEFAULT_TIMING_POLICY) === 'TIMING_DELAY') {
      return { unattributed: [entry], reason: 'TIMING_DELAY' };
    }
  }

  return { unattributed, reason };
}

export function reconcileDeterministicFastPath(input: {
  settlements: SettlementLike[];
  settlementComponents: SettlementComponentLike[];
  merchantTransactions: MerchantTransactionLike[];
  pspTransactions: PspTransactionLike[];
  bankEntries: BankEntryLike[];
  asOf?: string;
}): {
  integrity: SettlementIntegrityResult[];
  exactReferenceMatches: ReferenceMatch[];
  normalizedReferenceMatches: ReferenceMatch[];
  amountDateMatches: ReferenceMatch[];
  aggregateMatches: ReferenceMatch[];
  timingDelay: string[];
  ambiguity: IntentionObservation[];
  blockedSettlementIds: string[];
  reason: ReconciliationReasonCode | null;
} {
  const asOf = input.asOf ?? DEFAULT_TIMING_POLICY.asOf;
  const integrity = runSettlementIntegrityCheck(input.settlements, input.settlementComponents);
  const blockedSettlementIds = integrity.filter((item) => item.blocked).map((item) => item.settlementId);

  const exactReferenceMatches = findExactTransactionSettlementMatches(
    input.merchantTransactions,
    input.pspTransactions,
  );
  const normalizedReferenceMatches = findNormalizedReferenceMatches(
    input.merchantTransactions,
    input.pspTransactions,
  );
  const amountDateMatches = findAmountDateWindowMatches(
    input.merchantTransactions,
    input.pspTransactions,
  );
  const aggregateMatches = findSupportedAggregateMatches(input.settlements, input.bankEntries);

  const timingDelay = input.bankEntries
    .filter((entry) => resolveTimingStatus(asOf, entry.postedAt, DEFAULT_TIMING_POLICY) === 'TIMING_DELAY')
    .map((entry) => entry.id);

  const unresolvedReason: ReconciliationReasonCode | null =
    integrity.some((item) => item.status === 'INTEGRITY_FAILURE')
      ? 'INTEGRITY_FAILURE'
      : timingDelay.length > 0
        ? 'TIMING_DELAY'
        : null;

  const ambiguity: IntentionObservation[] = [];
  if (unresolvedReason !== null) {
    ambiguity.push({
      caseId: 'case-deterministic',
      caseType: 'SETTLEMENT_BANK',
      state: 'INVESTIGATING',
      reason: unresolvedReason,
      actionCount: 1,
      llmCallCount: 0,
      availableActions: ['RUN_INTEGRITY_CHECK', 'MATCH_EXACT', 'CHECK_TIMING', 'ESCALATE'],
      evidence: { settlementIds: blockedSettlementIds, bankEntryIds: timingDelay },
    });
  }

  const unattributed = evaluateUnattributedBankEntries(input.settlements, input.bankEntries, asOf);
  if (unattributed.reason !== null) {
    ambiguity.push({
      caseId: 'case-unattributed-bank',
      caseType: 'SETTLEMENT_BANK',
      state: 'INVESTIGATING',
      reason: unattributed.reason,
      actionCount: 2,
      llmCallCount: 0,
      availableActions: ['MATCH_AGGREGATE', 'CHECK_TIMING', 'INTERPRET_EVIDENCE', 'ESCALATE'],
      evidence: { bankEntryIds: unattributed.unattributed.map((entry) => entry.id) },
    });
  }

  return {
    integrity,
    exactReferenceMatches,
    normalizedReferenceMatches,
    amountDateMatches,
    aggregateMatches,
    timingDelay,
    ambiguity,
    blockedSettlementIds,
    reason: unresolvedReason ?? (unattributed.reason ?? null),
  };
}

export const MAX_LLM_CALLS_PER_CASE = 2;
export const RUN_LEVEL_LLM_BUDGET = 20;

export function calculateRunLevelLlmBudget(batchRecordCount: number): number {
  return Math.min(20, Math.max(5, Math.ceil(0.1 * batchRecordCount)));
}

export function assertAllocationLimit<T extends { id: string }>(claims: T[], limit: number, label: string): void {
  if (claims.length > limit) {
    throw new Error(`${label} exceeds allocation limit ${limit}: ${claims.length} claims.`);
  }
}

export function assertUniqueClaims<T extends { id: string }>(claims: T[], label: string): void {
  const seen = new Set<string>();
  for (const claim of claims) {
    if (seen.has(claim.id)) {
      throw new Error(`${label} contains duplicate claim: ${claim.id}`);
    }
    seen.add(claim.id);
  }
}

export function buildDeterministicObservation(
  caseId: string,
  caseType: 'TRANSACTION_SETTLEMENT' | 'SETTLEMENT_BANK',
  reason: ReconciliationReasonCode,
  evidence: Record<string, unknown>,
): AmbiguityObservation {
  return buildAmbiguityObservation({
    caseId,
    caseType,
    reason,
    evidence,
    actionCount: 1,
    llmCallCount: 0,
    availableActions: ['MATCH_EXACT', 'MATCH_COMPOSITE', 'CHECK_TIMING', 'ESCALATE'],
  });
}
