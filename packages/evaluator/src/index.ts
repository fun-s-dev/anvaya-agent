import { z } from 'zod';

import {
  requestAgentAction,
  shouldBypassLlm,
  type AgentCaseContext,
  type LlmProvider,
} from '@anvaya/agent';
import {
  generateScenario,
  type GeneratedScenario,
  type ScenarioMutation,
} from '@anvaya/generator';
import {
  calculateRunLevelLlmBudget,
  reconcileDeterministicFastPath,
} from '@anvaya/reconciliation';

export const EVALUATION_SEEDS = [7, 42, 99, 2024] as const;
export const EVALUATION_SIZES = [50, 100, 500] as const;

export const ModelMetadataSchema = z.object({
  prompt_version: z.string().default('part6-eval-v1'),
  model_name: z.string().default('deterministic-fast-path'),
  provider: z.string().default('deterministic'),
  call_id: z.string().default('deterministic-run'),
  case_id: z.string().default('case-eval'),
  input_evidence_ids: z.array(z.string()).default([]),
  output_schema_version: z.string().default('part6-eval-schema-v1'),
  latency_ms: z.number().int().nonnegative().default(0),
  retry_count: z.number().int().nonnegative().default(0),
  validation_result: z.enum(['valid', 'invalid', 'policy_rejected', 'timeout', 'error']).default('valid'),
});

export type ModelMetadata = z.infer<typeof ModelMetadataSchema>;
export type EvaluationMode = 'deterministic' | 'llm-assisted' | 'deterministic-fallback';
export type EvaluationDifficulty = 'clean' | 'adversarial';

export type EvaluatorRuntimeConfig = {
  llmProvider?: LlmProvider | null;
  batchRecordCount?: number;
  agentContextOverrides?: Partial<AgentCaseContext>;
};

export type ScenarioEvaluationMetrics = {
  transactionSettlementMatchRate: number;
  settlementBankMatchRate: number;
  finalStateAccuracy: number;
  reasonAccuracy: number;
  evidenceLinkAccuracy: number;
  falseResolutionRate: number;
  unresolvedFinancialValue: number;
  humanReviewRate: number;
  throughput: number;
  difficultCaseAccuracy: number;
};

export type ScenarioEvaluationResult = {
  scenarioId: string;
  seed: number;
  size: number;
  profile: 'clean' | 'adversarial';
  difficulty: EvaluationDifficulty;
  mode: EvaluationMode;
  predictedFinalState: 'VERIFIED' | 'PENDING' | 'ESCALATED';
  hiddenTruthFinalState: 'VERIFIED' | 'PENDING' | 'ESCALATED';
  actualReason: string | null;
  expectedReason: string;
  reasonAccuracy: number;
  modelMetadata: ModelMetadata;
  llmCallCount: number;
  llmBudgetExhausted: boolean;
  maxLlmCallBudget: number;
  metrics: ScenarioEvaluationMetrics;
  details: {
    txCorrect: number;
    txExpected: number;
    bankCorrect: number;
    bankExpected: number;
    evidenceMatches: number;
    evidenceExpected: number;
    falseResolved: boolean;
    difficultCase: boolean;
  };
};

export type BatchEvaluationReport = {
  generatedAt: string;
  cases: ScenarioEvaluationResult[];
  summary: {
    transactionSettlementMatchRate: number;
    settlementBankMatchRate: number;
    finalStateAccuracy: number;
    reasonAccuracy: number;
    evidenceLinkAccuracy: number;
    falseResolutionRate: number;
    unresolvedFinancialValue: number;
    humanReviewRate: number;
    throughput: number;
    difficultCaseAccuracy: number;
  };
  deterministicCases: ScenarioEvaluationResult[];
  llmAssistedCases: ScenarioEvaluationResult[];
  jsonReport: string;
  markdownReport: string;
};

export const DEFAULT_EVALUATION_CONFIG = [
  { seed: 7, size: 50, profile: 'clean' as const },
  { seed: 42, size: 100, profile: 'adversarial' as const },
  { seed: 99, size: 500, profile: 'clean' as const },
  { seed: 2024, size: 500, profile: 'adversarial' as const },
];

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function scenarioDifficulty(scenario: GeneratedScenario): EvaluationDifficulty {
  return scenario.hiddenTruth.mutations.length === 0 ? 'clean' : 'adversarial';
}

function buildEvidenceKey(link: {
  entityId: string;
  sourceType: 'merchant' | 'psp' | 'bank';
  sourceRecordId: string;
}): string {
  return `${link.entityId}:${link.sourceType}:${link.sourceRecordId}`;
}

function collectEvidenceLinksFromResult(
  scenario: GeneratedScenario,
  result: ReturnType<typeof reconcileDeterministicFastPath>,
): Array<{ entityId: string; sourceType: 'merchant' | 'psp' | 'bank'; sourceRecordId: string }> {
  const byKey = new Map<string, { entityId: string; sourceType: 'merchant' | 'psp' | 'bank'; sourceRecordId: string }>();

  for (const match of [...result.exactReferenceMatches, ...result.normalizedReferenceMatches, ...result.amountDateMatches]) {
    if (match.transactionId) {
      const tx = scenario.operationalRecords.merchantTransactions.find((item) => item.id === match.transactionId);
      if (tx) {
        const link = { entityId: tx.id, sourceType: 'merchant' as const, sourceRecordId: tx.sourceRecordId };
        byKey.set(buildEvidenceKey(link), link);
      }
    }
    if (match.pspTransactionId) {
      const psp = scenario.operationalRecords.pspTransactions.find((item) => item.id === match.pspTransactionId);
      if (psp) {
        const link = { entityId: psp.id, sourceType: 'psp' as const, sourceRecordId: psp.sourceRecordId };
        byKey.set(buildEvidenceKey(link), link);
      }
    }
    if (match.settlementId) {
      const settlement = scenario.operationalRecords.settlements.find((item) => item.id === match.settlementId);
      if (settlement) {
        const link = { entityId: settlement.id, sourceType: 'psp' as const, sourceRecordId: settlement.sourceRecordId };
        byKey.set(buildEvidenceKey(link), link);
      }
    }
  }

  for (const match of result.aggregateMatches) {
    if (match.settlementId) {
      const settlement = scenario.operationalRecords.settlements.find((item) => item.id === match.settlementId);
      if (settlement) {
        const link = { entityId: settlement.id, sourceType: 'psp' as const, sourceRecordId: settlement.sourceRecordId };
        byKey.set(buildEvidenceKey(link), link);
      }
    }
    if (match.bankEntryId) {
      const entry = scenario.operationalRecords.bankEntries.find((item) => item.id === match.bankEntryId);
      if (entry) {
        const link = { entityId: entry.id, sourceType: 'bank' as const, sourceRecordId: entry.sourceRecordId };
        byKey.set(buildEvidenceKey(link), link);
      }
    }
  }

  return [...byKey.values()];
}

export function derivePredictedFinalState(
  result: ReturnType<typeof reconcileDeterministicFastPath>,
): 'VERIFIED' | 'PENDING' | 'ESCALATED' {
  if (result.reason === null && result.conservationStatus === 'OK') {
    return 'VERIFIED';
  }
  if (result.pendingBankEntryIds.length > 0 || result.timingStatus.some((entry) => entry.status === 'PENDING')) {
    return 'PENDING';
  }
  return 'ESCALATED';
}

export function computeReasonAccuracy(expectedReason: string, actualReason: string | null): number {
  return expectedReason === actualReason ? 1 : 0;
}

export function summarizeReasonAccuracy(cases: ScenarioEvaluationResult[]): number {
  if (cases.length === 0) return 1;
  return cases.reduce((total, item) => total + item.reasonAccuracy, 0) / cases.length;
}

export function computeEvidenceLinkAccuracy(
  scenario: GeneratedScenario,
  result: ReturnType<typeof reconcileDeterministicFastPath>,
): number {
  const expectedEvidence = scenario.hiddenTruth.expectedEvidenceSourceLinks.map((link) => buildEvidenceKey(link));
  const predictedEvidence = collectEvidenceLinksFromResult(scenario, result).map((link) => buildEvidenceKey(link));
  const expectedSet = new Set(expectedEvidence);
  const predictedSet = new Set(predictedEvidence);
  const matched = [...expectedSet].filter((item) => predictedSet.has(item)).length;
  return expectedSet.size > 0 ? matched / expectedSet.size : 1;
}

export function computeScenarioMetrics(
  scenario: GeneratedScenario,
  result: ReturnType<typeof reconcileDeterministicFastPath>,
  elapsedMs: number,
): ScenarioEvaluationMetrics {
  const expectedRelationships = scenario.hiddenTruth.expectedRelationships;
  const expectedAllocations = scenario.hiddenTruth.expectedAllocations;

  const predictedTxByTransaction = new Map<string, string>();
  for (const match of [...result.exactReferenceMatches, ...result.normalizedReferenceMatches, ...result.amountDateMatches]) {
    if (match.transactionId && match.settlementId) {
      predictedTxByTransaction.set(match.transactionId, match.settlementId);
    }
  }

  const predictedBankBySettlement = new Map<string, Set<string>>();
  for (const match of result.aggregateMatches) {
    if (match.settlementId && match.bankEntryId) {
      const next = predictedBankBySettlement.get(match.settlementId) ?? new Set<string>();
      next.add(match.bankEntryId);
      predictedBankBySettlement.set(match.settlementId, next);
    }
  }

  let txCorrect = 0;
  for (const expected of expectedRelationships) {
    if (predictedTxByTransaction.get(expected.transactionId) === expected.settlementId) {
      txCorrect += 1;
    }
  }

  let bankCorrect = 0;
  for (const expected of expectedAllocations) {
    const banks = predictedBankBySettlement.get(expected.settlementId) ?? new Set<string>();
    if (banks.has(expected.bankEntryId)) {
      bankCorrect += 1;
    }
  }

  const transactionSettlementMatchRate = clampRatio(
    expectedRelationships.length > 0 ? txCorrect / expectedRelationships.length : 1,
  );
  const settlementBankMatchRate = clampRatio(
    expectedAllocations.length > 0 ? bankCorrect / expectedAllocations.length : 1,
  );
  const predictedFinalState = derivePredictedFinalState(result);
  const finalStateAccuracy = predictedFinalState === scenario.hiddenTruth.expectedFinalState ? 1 : 0;
  const reasonAccuracy = computeReasonAccuracy(scenario.hiddenTruth.expectedReason, result.reason);
  const evidenceLinkAccuracy = computeEvidenceLinkAccuracy(scenario, result);
  const falseResolved = predictedFinalState === 'VERIFIED' && scenario.hiddenTruth.expectedFinalState !== 'VERIFIED';
  const falseResolutionRate = falseResolved ? 1 : 0;
  const humanReviewRate = ['PENDING', 'ESCALATED'].includes(predictedFinalState) ? 1 : 0;
  const throughput = scenario.config.size / Math.max(1, elapsedMs / 1000);
  const difficultCase = scenario.hiddenTruth.mutations.length > 0 || scenario.hiddenTruth.expectedReason !== 'CLEAN';
  const difficultCaseAccuracy = difficultCase
    ? clampRatio((transactionSettlementMatchRate + settlementBankMatchRate + finalStateAccuracy + reasonAccuracy) / 4)
    : 1;

  return {
    transactionSettlementMatchRate,
    settlementBankMatchRate,
    finalStateAccuracy,
    reasonAccuracy,
    evidenceLinkAccuracy,
    falseResolutionRate,
    unresolvedFinancialValue: result.unresolvedAmountMinor,
    humanReviewRate,
    throughput,
    difficultCaseAccuracy,
  };
}

function buildEvidenceBundle(scenario: GeneratedScenario): Record<string, unknown> {
  return {
    merchant_transactions: scenario.operationalRecords.merchantTransactions.slice(0, 10),
    psp_transactions: scenario.operationalRecords.pspTransactions.slice(0, 10),
    settlements: scenario.operationalRecords.settlements.slice(0, 10),
    bank_entries: scenario.operationalRecords.bankEntries.slice(0, 10),
  };
}

export async function evaluateScenario(
  scenario: GeneratedScenario,
  input: Partial<Pick<ModelMetadata, 'prompt_version' | 'model_name' | 'provider' | 'call_id' | 'case_id' | 'output_schema_version'>> = {},
  runtime: EvaluatorRuntimeConfig = {},
): Promise<ScenarioEvaluationResult> {
  const startedAt = Date.now();
  const deterministicResult = reconcileDeterministicFastPath({
    settlements: scenario.operationalRecords.settlements,
    settlementComponents: scenario.operationalRecords.settlementComponents,
    merchantTransactions: scenario.operationalRecords.merchantTransactions,
    pspTransactions: scenario.operationalRecords.pspTransactions,
    bankEntries: scenario.operationalRecords.bankEntries,
  });
  const elapsedMs = Date.now() - startedAt;

  const difficulty = scenarioDifficulty(scenario);
  let mode: EvaluationMode = 'deterministic';
  let llmCallCount = 0;
  let llmBudgetExhausted = false;
  let predictedFinalState = derivePredictedFinalState(deterministicResult);
  let actualReason: string | null = deterministicResult.reason ?? null;

  const evidenceBundle = buildEvidenceBundle(scenario);
  const shouldRunAgent = Boolean(runtime.llmProvider) && !shouldBypassLlm({
    reason: deterministicResult.reason,
    state: predictedFinalState === 'VERIFIED' ? 'RESOLVED' : 'INVESTIGATING',
    actionCount: 0,
  });

  if (shouldRunAgent) {
    const caseContext: AgentCaseContext = {
      caseId: input.case_id ?? scenario.hiddenTruth.scenarioId,
      caseType: 'TRANSACTION_SETTLEMENT',
      state: 'INVESTIGATING',
      reason: deterministicResult.reason ?? 'AMBIGUOUS_REFERENCE',
      actionCount: 0,
      llmCallCount: 0,
      runLlmCallCount: 0,
      evidence: evidenceBundle,
      availableActions: ['RUN_INTEGRITY_CHECK', 'MATCH_EXACT', 'MATCH_COMPOSITE', 'MATCH_AGGREGATE', 'CHECK_TIMING', 'VALIDATE_CANDIDATE', 'ESCALATE'],
      batchRecordCount: runtime.batchRecordCount ?? scenario.config.size,
      ...runtime.agentContextOverrides,
    };

    const llmResult = await requestAgentAction(runtime.llmProvider ?? null, caseContext);
    llmCallCount = llmResult?.metadata ? 1 : 0;
    mode = llmCallCount > 0 ? 'llm-assisted' : 'deterministic-fallback';
    if (llmResult) {
      actualReason = llmResult.nextAction.next_action === 'ESCALATE'
        ? (llmResult.nextAction.reason as string)
        : actualReason;
      predictedFinalState = llmResult.stateAfter === 'ESCALATED' ? 'ESCALATED' : predictedFinalState;
    }
  } else if (runtime.llmProvider === null || runtime.llmProvider === undefined) {
    mode = 'deterministic';
  } else if (runtime.llmProvider && deterministicResult.reason !== null) {
    mode = 'deterministic-fallback';
  }

  if (mode === 'deterministic-fallback' && runtime.llmProvider === undefined) {
    llmBudgetExhausted = false;
  }

  const metrics = computeScenarioMetrics(scenario, deterministicResult, elapsedMs);
  const modelMetadata: ModelMetadata = ModelMetadataSchema.parse({
    prompt_version: input.prompt_version ?? 'part6-eval-v1',
    model_name: input.model_name ?? (mode === 'llm-assisted' ? 'mock-llm' : 'deterministic-fast-path'),
    provider: input.provider ?? (mode === 'llm-assisted' ? 'mock-provider' : 'deterministic'),
    call_id: input.call_id ?? `eval-${scenario.hiddenTruth.scenarioId}-${Date.now()}`,
    case_id: input.case_id ?? scenario.hiddenTruth.scenarioId,
    input_evidence_ids: scenario.hiddenTruth.expectedEvidenceSourceLinks.map((link) => buildEvidenceKey(link)),
    output_schema_version: input.output_schema_version ?? 'part6-eval-schema-v1',
    latency_ms: elapsedMs,
    retry_count: 0,
    validation_result: mode === 'llm-assisted' ? 'valid' : 'valid',
  });

  const expectedEvidence = scenario.hiddenTruth.expectedEvidenceSourceLinks.length;
  const predictedEvidence = collectEvidenceLinksFromResult(scenario, deterministicResult).length;

  return {
    scenarioId: scenario.hiddenTruth.scenarioId,
    seed: scenario.config.seed,
    size: scenario.config.size,
    profile: scenario.config.profile,
    difficulty,
    mode,
    predictedFinalState,
    hiddenTruthFinalState: scenario.hiddenTruth.expectedFinalState,
    actualReason,
    expectedReason: scenario.hiddenTruth.expectedReason,
    reasonAccuracy: computeReasonAccuracy(scenario.hiddenTruth.expectedReason, actualReason),
    modelMetadata,
    llmCallCount,
    llmBudgetExhausted,
    maxLlmCallBudget: calculateRunLevelLlmBudget(scenario.config.size),
    metrics: {
      ...metrics,
      evidenceLinkAccuracy: computeEvidenceLinkAccuracy(scenario, deterministicResult),
    },
    details: {
      txCorrect: scenario.hiddenTruth.expectedRelationships.filter((expected) => {
        const predicted = [...deterministicResult.exactReferenceMatches, ...deterministicResult.normalizedReferenceMatches, ...deterministicResult.amountDateMatches].find(
          (match) => match.transactionId === expected.transactionId,
        );
        return predicted?.settlementId === expected.settlementId;
      }).length,
      txExpected: scenario.hiddenTruth.expectedRelationships.length,
      bankCorrect: scenario.hiddenTruth.expectedAllocations.filter((expected) => {
        const predicted = deterministicResult.aggregateMatches.find(
          (match) => match.settlementId === expected.settlementId && match.bankEntryId === expected.bankEntryId,
        );
        return Boolean(predicted);
      }).length,
      bankExpected: scenario.hiddenTruth.expectedAllocations.length,
      evidenceMatches: expectedEvidence > 0 ? Math.min(expectedEvidence, predictedEvidence) : 0,
      evidenceExpected: expectedEvidence,
      falseResolved: predictedFinalState === 'VERIFIED' && scenario.hiddenTruth.expectedFinalState !== 'VERIFIED',
      difficultCase: scenario.hiddenTruth.mutations.length > 0 || scenario.hiddenTruth.expectedReason !== 'CLEAN',
    },
  };
}

export async function evaluateScenarioSuite(
  settings: Array<{
    seed: number;
    size: number;
    profile: 'clean' | 'adversarial';
    mutations?: ScenarioMutation[];
  }> = DEFAULT_EVALUATION_CONFIG,
  runtime: EvaluatorRuntimeConfig = {},
): Promise<BatchEvaluationReport> {
  const cases = await Promise.all(settings.map(async (item) => {
    const scenario = generateScenario({
      seed: item.seed,
      size: item.size,
      profile: item.profile,
      mutations: item.mutations,
    });
    return evaluateScenario(scenario, {
      case_id: `${scenario.hiddenTruth.scenarioId}-${item.size}`,
      call_id: `eval-${item.seed}-${item.size}-${item.profile}`,
    }, runtime);
  }));

  const summary = {
    transactionSettlementMatchRate: cases.reduce((sum, item) => sum + item.metrics.transactionSettlementMatchRate, 0) / Math.max(1, cases.length),
    settlementBankMatchRate: cases.reduce((sum, item) => sum + item.metrics.settlementBankMatchRate, 0) / Math.max(1, cases.length),
    finalStateAccuracy: cases.reduce((sum, item) => sum + item.metrics.finalStateAccuracy, 0) / Math.max(1, cases.length),
    reasonAccuracy: summarizeReasonAccuracy(cases),
    evidenceLinkAccuracy: cases.reduce((sum, item) => sum + item.metrics.evidenceLinkAccuracy, 0) / Math.max(1, cases.length),
    falseResolutionRate: cases.reduce((sum, item) => sum + item.metrics.falseResolutionRate, 0) / Math.max(1, cases.length),
    unresolvedFinancialValue: cases.reduce((sum, item) => sum + item.metrics.unresolvedFinancialValue, 0),
    humanReviewRate: cases.reduce((sum, item) => sum + item.metrics.humanReviewRate, 0) / Math.max(1, cases.length),
    throughput: cases.reduce((sum, item) => sum + item.metrics.throughput, 0) / Math.max(1, cases.length),
    difficultCaseAccuracy: cases.reduce((sum, item) => sum + item.metrics.difficultCaseAccuracy, 0) / Math.max(1, cases.length),
  };

  const deterministicCases = cases.filter((item) => item.mode === 'deterministic');
  const llmAssistedCases = cases.filter((item) => item.mode === 'llm-assisted');
  const generatedAt = new Date().toISOString();
  const jsonReport = JSON.stringify({
    generatedAt,
    summary,
    cases: cases.map((item) => ({
      scenarioId: item.scenarioId,
      seed: item.seed,
      size: item.size,
      profile: item.profile,
      difficulty: item.difficulty,
      mode: item.mode,
      predictedFinalState: item.predictedFinalState,
      hiddenTruthFinalState: item.hiddenTruthFinalState,
      actualReason: item.actualReason,
      expectedReason: item.expectedReason,
      modelMetadata: item.modelMetadata,
      llmCallCount: item.llmCallCount,
      llmBudgetExhausted: item.llmBudgetExhausted,
      maxLlmCallBudget: item.maxLlmCallBudget,
      metrics: item.metrics,
    })),
  }, null, 2);

  const markdownReport = buildMarkdownReport({
    summary,
    cases,
    deterministicCases,
    llmAssistedCases,
  });

  return {
    generatedAt,
    cases,
    summary,
    deterministicCases,
    llmAssistedCases,
    jsonReport,
    markdownReport,
  };
}

export function buildMarkdownReport(
  report: Pick<BatchEvaluationReport, 'summary' | 'cases' | 'deterministicCases' | 'llmAssistedCases'>,
): string {
  const lines = [
    '# Anvaya Evaluation Report',
    '',
    `Generated at: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    `- Transaction → settlement match rate: ${(report.summary.transactionSettlementMatchRate * 100).toFixed(2)}%`,
    `- Settlement → bank match rate: ${(report.summary.settlementBankMatchRate * 100).toFixed(2)}%`,
    `- Final-state accuracy: ${(report.summary.finalStateAccuracy * 100).toFixed(2)}%`,
    `- Reason accuracy: ${(report.summary.reasonAccuracy * 100).toFixed(2)}%`,
    `- Evidence/link accuracy: ${(report.summary.evidenceLinkAccuracy * 100).toFixed(2)}%`,
    `- False-resolution rate: ${(report.summary.falseResolutionRate * 100).toFixed(2)}%`,
    `- Unresolved value: ${report.summary.unresolvedFinancialValue} minor units`,
    `- Human-review rate: ${(report.summary.humanReviewRate * 100).toFixed(2)}%`,
    `- Throughput: ${report.summary.throughput.toFixed(2)} records/sec`,
    `- Difficult-case accuracy: ${(report.summary.difficultCaseAccuracy * 100).toFixed(2)}%`,
    '',
    '## Case breakdown',
    '',
  ];

  for (const item of report.cases) {
    lines.push(
      `- ${item.scenarioId} | seed=${item.seed} | size=${item.size} | mode=${item.mode} | difficulty=${item.difficulty} | predicted=${item.predictedFinalState} | expected=${item.hiddenTruthFinalState} | reason=${item.actualReason ?? 'null'} | txRate=${(item.metrics.transactionSettlementMatchRate * 100).toFixed(0)}% | bankRate=${(item.metrics.settlementBankMatchRate * 100).toFixed(0)}% | falseResolution=${item.metrics.falseResolutionRate}`,
    );
  }

  lines.push('', `Deterministic cases: ${report.deterministicCases.length}`, `LLM-assisted cases: ${report.llmAssistedCases.length}`);
  return lines.join('\n');
}

export function buildJsonReport(report: BatchEvaluationReport): string {
  return JSON.stringify(report, null, 2);
}

export async function evaluateFixedBenchmark(): Promise<BatchEvaluationReport> {
  return evaluateScenarioSuite(DEFAULT_EVALUATION_CONFIG);
}

export const evaluationHarness = {
  DEFAULT_EVALUATION_CONFIG,
  EVALUATION_SEEDS,
  EVALUATION_SIZES,
  evaluateScenario,
  evaluateScenarioSuite,
  evaluateFixedBenchmark,
  buildJsonReport,
  buildMarkdownReport,
};

export type EvaluationSummary = {
  matchRate: number;
  explainedVariance: number;
  unexplainedVariance: number;
};

export function createEvaluationSummary(): EvaluationSummary {
  return {
    matchRate: 0,
    explainedVariance: 0,
    unexplainedVariance: 0,
  };
}
