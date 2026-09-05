import { z } from 'zod';

export const CurrencyCodeSchema = z.enum(['INR', 'USD', 'EUR']);
export const SourceTypeSchema = z.enum(['merchant', 'psp', 'bank']);
export const ProviderNameSchema = z.enum(['razorpay', 'mock-provider']);

export const MoneyMinorSchema = z.number().int();

export const ImportRegistrationRequestSchema = z.object({
  provider: ProviderNameSchema,
  sourceType: SourceTypeSchema,
  filename: z.string().min(1).max(255),
  checksum: z.string().min(8).max(128),
  fileSizeBytes: z.number().int().nonnegative(),
  createdAt: z.string().datetime().optional(),
  importedAt: z.string().datetime().optional(),
  sourceRecordCount: z.number().int().nonnegative().optional().default(0),
});

export const ImportResponseSchema = z.object({
  id: z.string(),
  provider: ProviderNameSchema,
  sourceType: SourceTypeSchema,
  filename: z.string(),
  checksum: z.string(),
  fileSizeBytes: z.number().int().nonnegative(),
  status: z.enum(['received', 'validated', 'rejected']),
  createdAt: z.string().datetime(),
  importedAt: z.string().datetime(),
  sourceRecordCount: z.number().int().nonnegative(),
});

export const RunMetricsSchema = z.object({
  batchRecordCount: z.number().int().nonnegative(),
  matchRateTransactionSettlement: z.number().min(0).max(1),
  matchRateSettlementBank: z.number().min(0).max(1),
  verifiedValueMinor: z.number().int().nonnegative(),
  pendingValueMinor: z.number().int().nonnegative(),
  unresolvedValueMinor: z.number().int().nonnegative(),
  humanReviewRate: z.number().min(0).max(1),
  throughputPerHour: z.number().int().nonnegative(),
  llmCallsUsed: z.number().int().nonnegative(),
  llmCallBudget: z.number().int().nonnegative(),
  falseResolutionRate: z.number().min(0).max(1),
  explainedVarianceMinor: z.number().int().nonnegative(),
  unexplainedVarianceMinor: z.number().int().nonnegative(),
  verifiedCases: z.number().int().nonnegative(),
  pendingCases: z.number().int().nonnegative(),
  escalatedCases: z.number().int().nonnegative(),
});

export const ReconciliationRunSchema = z.object({
  runId: z.string().min(1),
  status: z.enum(['pending', 'running', 'complete', 'failed']),
  asOf: z.string().datetime(),
  metrics: RunMetricsSchema,
});

export const CanonicalFinancialEffectSchema = z.object({
  provider: ProviderNameSchema,
  sourceType: SourceTypeSchema,
  sourceRecordId: z.string().min(1),
  amountMinor: MoneyMinorSchema,
  currency: CurrencyCodeSchema,
  financialEffectMinor: MoneyMinorSchema,
});

export const ValidationIssueSchema = z.object({
  check: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(['error', 'warning']).default('error'),
});

export const DeterministicValidationResultSchema = z.object({
  status: z.enum(['VERIFIED', 'REJECTED', 'PENDING']),
  canBecomeVerified: z.boolean().default(false),
  evidenceIds: z.array(z.string()).default([]),
  sourceImportIds: z.array(z.string()).default([]),
  sourceRecordIds: z.array(z.string()).default([]),
  allocationMinor: z.number().int().default(0),
  unresolvedMinor: z.number().int().default(0),
  conserved: z.boolean().default(true),
  checks: z.array(ValidationIssueSchema).default([]),
});

export const ProofViewSchema = z.object({
  caseId: z.string().min(1),
  caseType: z.enum(['TRANSACTION_SETTLEMENT', 'SETTLEMENT_BANK']),
  machineState: z.string().min(1),
  machineReason: z.string().nullable().optional(),
  evidenceFound: z.array(z.string()).default([]),
  evidenceMissing: z.array(z.string()).default([]),
  auditTrail: z.array(z.unknown()).default([]),
  actionTrace: z.array(z.unknown()).default([]),
  humanReview: z.object({
    required: z.boolean().default(false),
    reason: z.string().optional(),
    comment: z.string().optional(),
    reviewedBy: z.string().optional(),
  }).default({ required: false }),
});

export const HumanResolutionRequestSchema = z.object({
  reason: z.string().min(1).max(255),
  comment: z.string().min(1).max(2000),
  reviewedBy: z.string().min(1).max(128).optional(),
  overrideState: z.enum(['PENDING', 'RESOLVED', 'ESCALATED']).optional(),
  sourceEvidence: z.array(z.string()).optional().default([]),
  candidate: z.record(z.unknown()).optional(),
  validationChecks: z.array(ValidationIssueSchema).optional().default([]),
});

export const HumanResolutionResultSchema = z.object({
  caseId: z.string().min(1),
  originalMachineState: z.string().min(1),
  originalMachineReason: z.string().nullable().optional(),
  humanState: z.enum(['PENDING', 'RESOLVED', 'ESCALATED']),
  reason: z.string().min(1),
  comment: z.string().min(1),
  reviewedBy: z.string().optional(),
  didOverwriteMachineDecision: z.boolean().default(false),
  sourceEvidence: z.array(z.string()).default([]),
  candidate: z.record(z.unknown()).optional(),
  validationChecks: z.array(ValidationIssueSchema).default([]),
});

export const ApiErrorSchema = z.object({
  error: z.string(),
  details: z.string().optional(),
});

export type ProviderName = z.infer<typeof ProviderNameSchema>;
export type SourceType = z.infer<typeof SourceTypeSchema>;
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;
export type ImportRegistrationRequest = z.infer<typeof ImportRegistrationRequestSchema>;
export type ImportResponse = z.infer<typeof ImportResponseSchema>;
export type RunMetrics = z.infer<typeof RunMetricsSchema>;
export type ReconciliationRun = z.infer<typeof ReconciliationRunSchema>;
export type CanonicalFinancialEffect = z.infer<typeof CanonicalFinancialEffectSchema>;
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
export type DeterministicValidationResult = z.infer<typeof DeterministicValidationResultSchema>;
export type ProofView = z.infer<typeof ProofViewSchema>;
export type HumanResolutionRequest = z.infer<typeof HumanResolutionRequestSchema>;
export type HumanResolutionResult = z.infer<typeof HumanResolutionResultSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
