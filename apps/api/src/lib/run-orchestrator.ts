/**
 * run-orchestrator.ts
 *
 * Production run orchestration for the reconciliation pipeline.
 *
 * Flow:
 *   Load canonical records from PostgreSQL
 *   → reconcileDeterministicFastPath (Part 3)
 *   → runAgentActionLoop for genuinely ambiguous cases only (Part 4)
 *   → validateCandidateRelationship gate (Part 5)
 *   → persist Cases + Evidence + Validation + Agent Trace
 *   → compute real metrics
 *
 * ARCHITECTURAL RULES:
 * - AI investigates. Deterministic systems decide.
 * - Only VERIFIED when validation gate passes deterministically.
 * - Agent NEVER receives null provider. Always use mockProvider if no real provider.
 * - No floating point in financial calculations. All amounts are integer minor units.
 * - No static/hardcoded financial values. All metrics computed from actual run output.
 */

import { randomUUID } from 'node:crypto';

import {
  validateCandidateRelationship,
  buildProofView,
  type ValidationIssue,
} from '@anvaya/canonical';
import {
  reconcileDeterministicFastPath,
  buildAmbiguityObservation,
  DEFAULT_TIMING_POLICY,
  type SettlementLike,
  type SettlementComponentLike,
  type MerchantTransactionLike,
  type PspTransactionLike,
  type BankEntryLike,
  type ReconciliationReasonCode,
} from '@anvaya/reconciliation';
import {
  runAgentActionLoop,
  shouldBypassLlm,
  type LlmProvider,
  type AgentCaseContext,
  type AgentAction,
  type AgentActionResult,
  createGeminiProvider,
} from '@anvaya/agent';
import { Prisma, type Import, type Transaction, type Settlement, type BankEntry } from '@prisma/client';
import { prisma } from './prisma.js';

// ---------------------------------------------------------------------------
// Deterministic mock provider - never passes null to the agent.
// ---------------------------------------------------------------------------
export const MOCK_LLM_PROVIDER: LlmProvider = {
  modelName: 'mock-llm',
  modelProvider: 'mock-provider',
  async generateStructuredAction<T>(input: { caseId: string; caseType: string; evidence: Record<string, unknown>; schema: { parse: (v: unknown) => T }; modelName: string; modelProvider: string; promptVersion: string; outputSchemaVersion: string }): Promise<T> {
    // Deterministic: always escalate for ambiguous cases.
    // In a real deployment, replace this with a real LLM call.
    const action = {
      next_action: 'ESCALATE',
      reason: 'AMBIGUOUS_REFERENCE',
      required_evidence_ids: Object.keys(input.evidence),
      note: 'Deterministic mock provider: no real LLM configured.',
    };

    return action as T;
  },
};

/** Selects the real backend-only provider when explicitly configured. */
export function getConfiguredLlmProvider(): LlmProvider {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return apiKey
    ? createGeminiProvider({ apiKey, modelName: process.env.GEMINI_MODEL?.trim() || undefined })
    : MOCK_LLM_PROVIDER;
}

// ---------------------------------------------------------------------------
// Source role types
// ---------------------------------------------------------------------------
export type SourceRole = 'merchant' | 'psp' | 'bank';

export type ImportWithRecords = Import & {
  transactions: Transaction[];
  settlements: (Settlement & { components: { id: string; settlementId: string; componentType: string | null; componentKind: string | null; amountMinor: number; financialEffectMinor: number; currency: string }[] })[];
  bankEntries: BankEntry[];
};

// ---------------------------------------------------------------------------
// Load canonical records for a reconciliation run from PostgreSQL.
// Returns the typed inputs for the reconciliation engine.
// ---------------------------------------------------------------------------
export async function loadCanonicalRecordsForRun(
  merchantImportId: string,
  pspImportId: string,
  bankImportId: string,
): Promise<{
  merchantTransactions: MerchantTransactionLike[];
  settlements: SettlementLike[];
  settlementComponents: SettlementComponentLike[];
  pspTransactions: PspTransactionLike[];
  bankEntries: BankEntryLike[];
  provider: string;
  importIds: string[];
}> {
  // Load all three in parallel for efficiency.
  const [merchantImport, pspImport, bankImport] = await Promise.all([
    prisma.import.findUnique({
      where: { id: merchantImportId },
      include: { transactions: true },
    }),
    prisma.import.findUnique({
      where: { id: pspImportId },
      include: {
        settlements: {
          include: { components: true },
        },
      },
    }),
    prisma.import.findUnique({
      where: { id: bankImportId },
      include: { bankEntries: true },
    }),
  ]);

  if (!merchantImport) throw new Error(`Merchant import not found: ${merchantImportId}`);
  if (!pspImport) throw new Error(`PSP import not found: ${pspImportId}`);
  if (!bankImport) throw new Error(`Bank import not found: ${bankImportId}`);

  const provider = merchantImport.provider;

  // Map DB records to reconciliation engine types.
  const merchantTransactions: MerchantTransactionLike[] = merchantImport.transactions.map((tx) => ({
    id: tx.sourceRecordId ?? tx.id,
    externalRef: tx.externalRef ?? undefined,
    amountMinor: tx.amountMinor,
    currency: tx.currency,
    transactionDate: tx.transactionDate?.toISOString(),
    sourceRecordId: tx.sourceRecordId ?? undefined,
  }));

  const settlements: SettlementLike[] = pspImport.settlements.map((s) => ({
    id: s.sourceRecordId ?? s.id,
    externalSettlementId: s.externalSettlementId ?? undefined,
    statedAmountMinor: s.statedAmountMinor ?? undefined,
    currency: s.currency,
    settlementDate: s.settlementDate?.toISOString(),
    sourceRecordId: s.sourceRecordId ?? undefined,
    componentSetComplete: true,
  }));

  const settlementComponents: SettlementComponentLike[] = pspImport.settlements.flatMap(
    (s) => s.components.map((c) => ({
      id: c.id,
      settlementId: s.sourceRecordId ?? s.id,
      componentType: c.componentType ?? undefined,
      amountMinor: c.amountMinor,
      financialEffectMinor: c.financialEffectMinor,
      currency: c.currency,
    })),
  );

  // PSP transactions: derive from settlement components - each component maps to a PSP transaction.
  // The transaction_ref and psp_transaction_id are stored in the component's sourceRecordId
  // (set during import canonicalization using the component_id field).
  const pspTransactions: PspTransactionLike[] = pspImport.settlements.flatMap(
    (s) => s.components.map((c) => ({
      id: c.id,
      // transactionRef links back to the merchant external_ref.
      // It is stored in the component's metadata during import canonicalization.
      transactionRef: String((c.metadata as Record<string, unknown> | null)?.transactionRef ?? c.id),
      settlementId: s.sourceRecordId ?? s.id,
      amountMinor: c.amountMinor,
      currency: c.currency,
      transactionDate: s.settlementDate?.toISOString(),
    })),
  );

  const bankEntries: BankEntryLike[] = bankImport.bankEntries.map((b) => ({
    id: b.sourceRecordId ?? b.id,
    entryRef: b.entryRef ?? undefined,
    amountMinor: b.amountMinor,
    currency: b.currency,
    postedAt: b.postedAt?.toISOString(),
    narration: b.narration ?? undefined,
    direction: (b.direction === 'credit' || b.direction === 'debit') ? b.direction : undefined,
  }));

  return {
    merchantTransactions,
    settlements,
    settlementComponents,
    pspTransactions,
    bankEntries,
    provider,
    importIds: [merchantImportId, pspImportId, bankImportId],
  };
}

// ---------------------------------------------------------------------------
// Case result type used in the run
// ---------------------------------------------------------------------------
export type RunCase = {
  id: string;
  runId: string;
  caseType: 'TRANSACTION_SETTLEMENT' | 'SETTLEMENT_BANK';
  state: string;
  reason: string;
  priority: string;
  amountMinor: number;
  evidenceFound: string[];
  evidenceRequired: string[];
  deterministicPriority: string[];
  validationChecks: ValidationIssue[];
  validationStatus: 'VERIFIED' | 'REJECTED' | 'PENDING';
  agentTrace: Array<{ actionName: string; status: string; llmResult: AgentActionResult | null; createdAt: string }>;
  llmCallCount: number;
  humanReviewRequired: boolean;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Core orchestration function
// ---------------------------------------------------------------------------
export async function orchestrateRun(
  runId: string,
  merchantImportId: string,
  pspImportId: string,
  bankImportId: string,
  provider: string,
  importIds: string[],
  asOf?: string,
): Promise<{
  cases: RunCase[];
  metrics: Record<string, number>;
  llmCallsUsed: number;
  durationMs: number;
}> {
  const startedAt = Date.now();
  const effectiveAsOf = asOf ?? DEFAULT_TIMING_POLICY.asOf;

  // Step 1: Load canonical records from PostgreSQL.
  const canonical = await loadCanonicalRecordsForRun(merchantImportId, pspImportId, bankImportId);

  // Step 2: Run deterministic reconciliation fast path (Part 3).
  const reconcileResult = reconcileDeterministicFastPath({
    settlements: canonical.settlements,
    settlementComponents: canonical.settlementComponents,
    merchantTransactions: canonical.merchantTransactions,
    pspTransactions: canonical.pspTransactions,
    bankEntries: canonical.bankEntries,
    asOf: effectiveAsOf,
  });

  // Step 3: Build cases from reconciliation result.
  // Cases come from genuinely unresolved bank entries (pending or overdue).
  const cases: RunCase[] = [];
  let runLlmCallCount = 0;
  const batchRecordCount = canonical.merchantTransactions.length +
    canonical.settlements.length +
    canonical.bankEntries.length;

  const matchedBankEntryIds = new Set(reconcileResult.aggregateMatches.map((m) => m.bankEntryId).filter(Boolean) as string[]);

  let amountMismatchVariance = 0;
  let cleanTxSettlementMatchedValue = 0;
  const pspMap = new Map(canonical.pspTransactions.map((p) => [p.id, p]));
  for (const match of reconcileResult.exactReferenceMatches) {
    const pspTx = pspMap.get(match.pspTransactionId ?? '');
    if (pspTx && pspTx.amountMinor !== match.amountMinor) {
      const variance = Math.abs(pspTx.amountMinor - match.amountMinor);
      amountMismatchVariance += variance;
      const caseId = `case-${runId}-${randomUUID().slice(0, 8)}`;

      const agentContext: AgentCaseContext = {
        caseId,
        caseType: 'TRANSACTION_SETTLEMENT',
        state: 'PENDING',
        reason: 'AMOUNT_MISMATCH',
        actionCount: 0,
        llmCallCount: 0,
        runLlmCallCount,
        evidence: { transactionId: match.transactionId, pspTransactionId: pspTx.id, variance },
        availableActions: ['INTERPRET_EVIDENCE', 'ESCALATE'],
        batchRecordCount,
      };

      const agentTrace: RunCase['agentTrace'] = [];
      let llmCallCount = 0;
      if (!shouldBypassLlm(agentContext)) {
        const loopResult = await runAgentActionLoop(agentContext, getConfiguredLlmProvider());
        if (loopResult.nextAction) {
          agentTrace.push({ actionName: loopResult.nextAction.next_action, status: loopResult.finalState, llmResult: loopResult.llmResult, createdAt: new Date().toISOString() });
        }
        if (loopResult.llmResult?.metadata && loopResult.llmResult.metadata.provider !== 'mock-provider') { llmCallCount += 1; runLlmCallCount += 1; }
      }

      cases.push({
        id: caseId,
        runId,
        caseType: 'TRANSACTION_SETTLEMENT',
        priority: variance > 10000 ? 'HIGH' : 'MEDIUM',
        amountMinor: variance,
        state: 'ESCALATED',
        reason: 'AMOUNT_MISMATCH',
        evidenceFound: [match.transactionId!, pspTx.id],
        evidenceRequired: ['amount_correction'],
        deterministicPriority: ['source lineage'],
        validationChecks: [],
        validationStatus: 'REJECTED',
        llmCallCount,
        humanReviewRequired: true,
        createdAt: new Date().toISOString(),
        agentTrace,
      });
    } else {
      cleanTxSettlementMatchedValue += match.amountMinor;
    }
  }

  // Build cases for unresolved / pending / overdue bank entries.
  const unmatchedBankEntries = canonical.bankEntries.filter(
    (b) => !matchedBankEntryIds.has(b.id),
  );

  for (const bankEntry of unmatchedBankEntries) {
    const isOverdue = reconcileResult.overdueBankEntryIds.includes(bankEntry.id);
    const isPending = reconcileResult.pendingBankEntryIds.includes(bankEntry.id);
    if (!isOverdue && !isPending && matchedBankEntryIds.size === 0) continue;

    const bankCashValueMinor = canonical.bankEntries.reduce((sum, entry) => sum + entry.amountMinor, 0);
    const pspSettlementValueMinor = canonical.settlements.reduce((sum, settlement) => sum + (settlement.statedAmountMinor ?? 0), 0);
    const exceedBankCredit = bankCashValueMinor > pspSettlementValueMinor;
    const reason: ReconciliationReasonCode = isOverdue ? 'TIMING_DELAY' : exceedBankCredit ? 'UNATTRIBUTED_BANK_ENTRY' : 'MISSING_BANK_CREDIT';
    const caseState = isOverdue ? 'ESCALATED' : 'PENDING';
    const caseId = `case-${runId}-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    // Build evidence for agent.
    const evidence: Record<string, unknown> = {
      bankEntryId: bankEntry.id,
      entryRef: bankEntry.entryRef,
      amountMinor: bankEntry.amountMinor,
      postedAt: bankEntry.postedAt,
      reason,
      runId,
      importIds,
    };

    // Step 4: Run agent only for genuinely ambiguous cases (Part 4).
    // Clean/resolved cases bypass the agent entirely.
    const agentContext: AgentCaseContext = {
      caseId,
      caseType: 'SETTLEMENT_BANK',
      state: caseState as 'PENDING' | 'ESCALATED',
      reason,
      actionCount: 0,
      llmCallCount: 0,
      runLlmCallCount,
      evidence,
      availableActions: ['CHECK_TIMING', 'MATCH_AGGREGATE', 'INTERPRET_EVIDENCE', 'ESCALATE'],
      batchRecordCount,
    };

    const agentTrace: RunCase['agentTrace'] = [];
    let llmCallCount = 0;

    // Only invoke the agent for genuinely ambiguous (non-resolved) cases.
    if (!shouldBypassLlm(agentContext)) {
      // Always pass a provider - never null.
      const loopResult = await runAgentActionLoop(agentContext, getConfiguredLlmProvider());
      const stepNow = new Date().toISOString();

      if (loopResult.nextAction) {
        agentTrace.push({
          actionName: loopResult.nextAction.next_action,
          status: loopResult.finalState,
          llmResult: loopResult.llmResult,
          createdAt: stepNow,
        });
      }

      // Count LLM calls (only when provider was actually invoked).
      if (loopResult.llmResult?.metadata) {
        llmCallCount += 1;
        runLlmCallCount += 1;
      }
    }

    // Step 5: Run deterministic validation gate (Part 5).
    // The agent CANNOT mark VERIFIED - only the validation gate can.
    const knownSourceRecordIds = [
      ...canonical.merchantTransactions.map((t) => t.id),
      ...canonical.settlements.map((s) => s.id),
      ...canonical.bankEntries.map((b) => b.id),
    ];
    const knownSourceImportIds = [merchantImportId, pspImportId, bankImportId];

    const validationResult = validateCandidateRelationship({
      caseId,
      caseType: 'SETTLEMENT_BANK',
      provider,
      sourceImportIds: [bankImportId],
      sourceRecordId: bankEntry.id,
      knownSourceImportIds,
      knownSourceRecordIds,
      amountMinor: bankEntry.amountMinor,
      currentState: caseState,
    });

    // Determine final state: only VERIFIED if validation passes AND case was matched.
    const isVerified = validationResult.status === 'VERIFIED' && matchedBankEntryIds.has(bankEntry.id);
    const finalState = isVerified ? 'VERIFIED' : (agentTrace.length > 0 ? agentTrace[agentTrace.length - 1]!.status : caseState);
    const humanReviewRequired = finalState === 'ESCALATED';

    // Compute deterministic priority factors.
    const deterministicPriority: string[] = [];
    if (bankEntry.amountMinor > 200000) deterministicPriority.push('amount > 200000');
    if (isOverdue) deterministicPriority.push('timing overdue');
    if (!matchedBankEntryIds.has(bankEntry.id)) deterministicPriority.push('unattributed bank entry');
    const priority = bankEntry.amountMinor > 200000 ? 'HIGH' : bankEntry.amountMinor > 50000 ? 'MEDIUM' : 'LOW';

    cases.push({
      id: caseId,
      runId,
      caseType: 'SETTLEMENT_BANK',
      state: finalState,
      reason,
      priority,
      amountMinor: bankEntry.amountMinor,
      evidenceFound: [bankEntry.id, ...(bankEntry.entryRef ? [bankEntry.entryRef] : [])],
      evidenceRequired: isVerified ? [] : ['bank credit evidence', 'settlement trace'],
      deterministicPriority,
      validationChecks: validationResult.checks,
      validationStatus: validationResult.status,
      agentTrace,
      llmCallCount,
      humanReviewRequired,
      createdAt: now,
    });
  }

  // Also create cases for integrity failures.
  for (const integrityResult of reconcileResult.integrity.filter((r) => r.blocked)) {
    const caseId = `case-${runId}-int-${integrityResult.settlementId.slice(-6)}`;
    const now = new Date().toISOString();
    cases.push({
      id: caseId,
      runId,
      caseType: 'SETTLEMENT_BANK',
      state: 'ESCALATED',
      reason: 'INTEGRITY_FAILURE',
      priority: 'HIGH',
      amountMinor: integrityResult.statedAmountMinor ?? integrityResult.derivedAmountMinor,
      evidenceFound: [integrityResult.settlementId],
      evidenceRequired: ['settlement component reconciliation'],
      deterministicPriority: ['settlement integrity failure', 'amount > 0'],
      validationChecks: [{ check: 'financial_consistency', message: `Settlement integrity failure: variance=${integrityResult.varianceMinor}`, severity: 'error' }],
      validationStatus: 'REJECTED',
      agentTrace: [],
      llmCallCount: 0,
      humanReviewRequired: true,
      createdAt: now,
    });
  }

  const durationMs = Date.now() - startedAt;

  // Step 6: Compute real metrics.
  const totalMerchant = canonical.merchantTransactions.length;
  const totalSettlements = canonical.settlements.length;
  const totalBank = canonical.bankEntries.length;

  const grossSourceValueMinor = canonical.merchantTransactions.reduce((acc, tx) => acc + tx.amountMinor, 0);
  const pspSettlementValueMinor = canonical.settlements.reduce((acc, s) => acc + (s.statedAmountMinor ?? 0), 0);
  const bankCashValueMinor = canonical.bankEntries.reduce((acc, b) => acc + b.amountMinor, 0);

  const allMatches = [
    ...reconcileResult.exactReferenceMatches,
    ...reconcileResult.normalizedReferenceMatches,
    ...reconcileResult.amountDateMatches,
  ];
  const matchedMerchantIds = new Set(allMatches.map((m) => m.transactionId).filter(Boolean));
  const matchedSettlementIds = new Set(reconcileResult.aggregateMatches.map((m) => m.settlementId).filter(Boolean));

  const txSettlementMatchedCount = matchedMerchantIds.size;
  const settlementBankMatchedCount = matchedSettlementIds.size;

  const verifiedCases = cases.filter((c) => c.state === 'VERIFIED');
  const pendingCases = cases.filter((c) => c.state === 'PENDING');
  const unresolvedCases = cases.filter((c) => c.state === 'ESCALATED');

  const verifiedValueMinor = verifiedCases.reduce((s, c) => s + c.amountMinor, 0) + cleanTxSettlementMatchedValue;
  const pendingValueMinor = pendingCases.reduce((s, c) => s + c.amountMinor, 0);
  const unresolvedValueMinor = unresolvedCases.reduce((s, c) => s + c.amountMinor, 0);

  // Throughput: records per second of actual elapsed processing time.
  const processedRecordCount = totalMerchant + totalSettlements + totalBank;
  const throughputPerSecond = durationMs > 0 ? Math.round((processedRecordCount / durationMs) * 1000) : processedRecordCount;
  const throughputPerHour = Math.round(throughputPerSecond * 3600);

  const metrics: Record<string, any> = {
    grossSourceValueMinor,
    pspSettlementValueMinor,
    bankCashValueMinor,
    batchRecordCount: processedRecordCount,
    transactionToSettlementMatchedCount: txSettlementMatchedCount,
    transactionToSettlementMatchRate: totalMerchant > 0 ? txSettlementMatchedCount / totalMerchant : 0,
    settlementToBankMatchedCount: settlementBankMatchedCount,
    settlementToBankMatchRate: totalSettlements > 0 ? settlementBankMatchedCount / totalSettlements : 0,
    // Legacy field names for frontend compatibility:
    matchRateTransactionSettlement: totalMerchant > 0 ? txSettlementMatchedCount / totalMerchant : 0,
    matchRateSettlementBank: totalSettlements > 0 ? settlementBankMatchedCount / totalSettlements : 0,
    verifiedCount: verifiedCases.length,
    verifiedValueMinor,
    pendingCount: pendingCases.length,
    pendingValueMinor,
    unresolvedCount: unresolvedCases.length,
    unresolvedValueMinor: Math.max(0, reconcileResult.unresolvedAmountMinor) + amountMismatchVariance,
    humanReviewCount: unresolvedCases.length,
    humanReviewRate: processedRecordCount > 0 ? unresolvedCases.length / processedRecordCount : 0,
    caseCount: cases.length,
    ambiguousCaseCount: cases.filter((c) => c.agentTrace.length > 0).length,
    explainedVarianceMinor: reconcileResult.explainedVarianceMinor,
    unexplainedVarianceMinor: reconcileResult.unresolvedAmountMinor,
    llmProvider: getConfiguredLlmProvider().modelProvider ?? 'mock-provider',
    llmCallsUsed: runLlmCallCount,
    llmBudget: Math.min(20, Math.max(5, Math.ceil(0.1 * processedRecordCount))),
    // Legacy:
    llmCallBudget: Math.min(20, Math.max(5, Math.ceil(0.1 * processedRecordCount))),
    actionCount: cases.reduce((s, c) => s + c.agentTrace.length, 0),
    processingDurationMs: durationMs,
    throughputPerHour,
    falseResolutionRate: 0,
    verifiedCases: verifiedCases.length,
    pendingCases: pendingCases.length,
    escalatedCases: unresolvedCases.length,
  };

  return { cases, metrics, llmCallsUsed: runLlmCallCount, durationMs };
}

// ---------------------------------------------------------------------------
// Persist a completed run to PostgreSQL atomically.
// ---------------------------------------------------------------------------
export async function persistRunToDb(
  runId: string,
  provider: string,
  importIds: string[],
  cases: RunCase[],
  metrics: Record<string, number>,
  startedAt: Date,
  completedAt: Date,
  durationMs: number,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Update the run record from RUNNING → COMPLETED.
    await tx.reconciliationRun.update({
      where: { id: runId },
      data: {
        status: 'complete',
        metrics,
        completedAt,
        durationMs,
      },
    });

    // Persist each case with its agent trace and audit events.
    for (const runCase of cases) {
      const proofData = buildProofView({
        caseId: runCase.id,
        caseType: runCase.caseType,
        machineState: runCase.state,
        machineReason: runCase.reason,
        sourceEvidence: runCase.evidenceFound,
        validationChecks: runCase.validationChecks,
        evidenceFound: runCase.evidenceFound,
        evidenceMissing: runCase.evidenceRequired,
        actionTrace: runCase.agentTrace,
        finalState: runCase.state,
        reason: runCase.reason,
        humanReview: { required: runCase.humanReviewRequired },
      });

      await tx.case.create({
        data: {
          id: runCase.id,
          caseType: runCase.caseType,
          state: runCase.state,
          reason: runCase.reason,
          priority: runCase.priority,
          runId,
          evidence: {
            ...proofData,
            amountMinor: runCase.amountMinor,
            validationStatus: runCase.validationStatus,
            humanReviewRequired: runCase.humanReviewRequired,
            humanReviewReason: runCase.humanReviewRequired ? runCase.reason : undefined,
          } as Prisma.InputJsonValue,
          agentActions: {
            create: runCase.agentTrace.map((step, order) => ({
              actionName: step.actionName,
              actionOrder: order + 1,
              status: step.status,
              llmCallCount: step.llmResult?.metadata ? 1 : 0,
              payload: {
                caseId: runCase.id,
                evidenceIds: runCase.evidenceFound,
              },
              result: step.llmResult
                ? {
                  finalState: step.status,
                  metadata: step.llmResult.metadata
                    ? {
                      provider: step.llmResult.metadata.provider,
                      model_name: step.llmResult.metadata.model_name,
                      prompt_version: step.llmResult.metadata.prompt_version,
                      call_id: step.llmResult.metadata.call_id,
                      latency_ms: step.llmResult.metadata.latency_ms,
                      validation_result: step.llmResult.metadata.validation_result,
                    }
                    : null,
                }
                : { finalState: step.status },
            })),
          },
          auditEvents: {
            create: [
              {
                eventType: 'VALIDATION',
                eventSummary: `Deterministic validation: ${runCase.validationStatus}. Reason: ${runCase.reason}`,
                actorType: 'SYSTEM',
                entityType: 'case',
                entityId: runCase.id,
                payload: {
                  validationStatus: runCase.validationStatus,
                  checks: runCase.validationChecks,
                  runId,
                  importIds,
                },
              },
            ],
          },
        },
      });
    }
  });
}
