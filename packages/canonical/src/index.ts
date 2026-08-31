import { type CurrencyCode, type ProviderName, type SourceType } from '@anvaya/contracts';

export type CanonicalRecordIdentity = {
  provider: ProviderName;
  sourceType: SourceType;
  sourceRecordId: string;
};

export type CanonicalFinancialEffect = {
  provider: ProviderName;
  sourceType: SourceType;
  sourceRecordId: string;
  amountMinor: number;
  currency: CurrencyCode;
  financialEffectMinor: number;
};

export function buildSourceRecordKey(identity: CanonicalRecordIdentity): string {
  return `${identity.provider}:${identity.sourceType}:${identity.sourceRecordId}`;
}

export function createCanonicalFinancialEffect(input: {
  provider: ProviderName;
  sourceType: SourceType;
  sourceRecordId: string;
  amountMinor: number;
  currency: CurrencyCode;
  financialEffectMinor: number;
}): CanonicalFinancialEffect {
  if (!Number.isInteger(input.amountMinor) || !Number.isInteger(input.financialEffectMinor)) {
    throw new Error('Financial amounts must use integer minor units.');
  }

  if (!input.sourceRecordId.trim()) {
    throw new Error('sourceRecordId is required for canonical financial effects.');
  }

  return {
    ...input,
  };
}

export function assertSourceRecordUniqueness(
  existing: CanonicalFinancialEffect[],
  candidate: CanonicalFinancialEffect,
): void {
  const duplicate = existing.some((record) => {
    return (
      record.provider === candidate.provider &&
      record.sourceType === candidate.sourceType &&
      record.sourceRecordId === candidate.sourceRecordId
    );
  });

  if (duplicate) {
    throw new Error(
      `Duplicate canonical financial effect for provider=${candidate.provider}, sourceType=${candidate.sourceType}, sourceRecordId=${candidate.sourceRecordId}.`,
    );
  }
}

export function appendCanonicalFinancialEffect(
  existing: CanonicalFinancialEffect[],
  candidate: CanonicalFinancialEffect,
): CanonicalFinancialEffect[] {
  assertSourceRecordUniqueness(existing, candidate);
  return [...existing, candidate];
}

export function isStableSourceIdentity(identity: Partial<CanonicalRecordIdentity>): boolean {
  return Boolean(identity.provider && identity.sourceType && identity.sourceRecordId);
}

export type ValidationCheckSeverity = 'error' | 'warning';

export type ValidationIssue = {
  check: string;
  message: string;
  severity: ValidationCheckSeverity;
};

export type DeterministicValidationResult = {
  status: 'VERIFIED' | 'REJECTED' | 'PENDING';
  canBecomeVerified: boolean;
  evidenceIds: string[];
  sourceImportIds: string[];
  sourceRecordIds: string[];
  allocationMinor: number;
  unresolvedMinor: number;
  conserved: boolean;
  checks: ValidationIssue[];
};

export type CandidateValidationInput = {
  id?: string;
  caseId?: string;
  caseType?: 'TRANSACTION_SETTLEMENT' | 'SETTLEMENT_BANK';
  provider?: string;
  sourceImportId?: string;
  sourceImportIds?: string[];
  knownSourceImportIds?: string[];
  sourceRecordIds?: string[];
  sourceRecordId?: string;
  knownSourceRecordIds?: string[];
  evidenceIds?: string[];
  knownEvidenceIds?: string[];
  amountMinor?: number;
  financialEffectMinor?: number;
  creditMinor?: number;
  debitMinor?: number;
  transactionDate?: string;
  settlementDate?: string;
  postedAt?: string;
  currentState?: string;
  expectedState?: string;
  existingClaims?: Array<{ id?: string; amountMinor: number; sourceRecordId?: string; sourceImportId?: string }>;
  availableMinor?: number;
  allocatedMinor?: number;
  sourceRecordIdSet?: string[];
  metadata?: Record<string, unknown>;
};

export type ProofView = {
  caseId: string;
  caseType: 'TRANSACTION_SETTLEMENT' | 'SETTLEMENT_BANK';
  machineState: string;
  machineReason?: string | null;
  sourceEvidence: string[];
  candidate: Record<string, unknown> | null;
  validationChecks: ValidationIssue[];
  evidenceFound: string[];
  evidenceMissing: string[];
  auditTrail: unknown[];
  actionTrace: unknown[];
  finalState: string;
  reason?: string | null;
  humanReview: {
    required: boolean;
    reason?: string;
    comment?: string;
    reviewedBy?: string;
  };
};

export type HumanResolutionRequest = {
  reason: string;
  comment: string;
  reviewedBy?: string;
  overrideState?: 'PENDING' | 'RESOLVED' | 'ESCALATED';
};

export type HumanResolutionResult = {
  caseId: string;
  originalMachineState: string;
  originalMachineReason?: string | null;
  humanState: 'PENDING' | 'RESOLVED' | 'ESCALATED';
  reason: string;
  comment: string;
  reviewedBy?: string;
  didOverwriteMachineDecision: boolean;
};

export function createValidationIssue(check: string, message: string, severity: ValidationCheckSeverity = 'error'): ValidationIssue {
  return { check, message, severity };
}

export function buildEvidenceLineage(input: {
  sourceImportIds?: string[];
  sourceRecordIds?: string[];
  evidenceIds?: string[];
} = {}): { sourceImportIds: string[]; sourceRecordIds: string[]; evidenceIds: string[] } {
  return {
    sourceImportIds: [...new Set((input.sourceImportIds ?? []).filter(Boolean))],
    sourceRecordIds: [...new Set((input.sourceRecordIds ?? []).filter(Boolean))],
    evidenceIds: [...new Set((input.evidenceIds ?? []).filter(Boolean))],
  };
}

export function validateAllocationWriteGuard(input: {
  existingAllocations: Array<{ id?: string; amountMinor: number; settlementId?: string; bankEntryId?: string }>;
  candidateAmountMinor: number;
  availableMinor: number;
  settlementId?: string;
  bankEntryId?: string;
}): { valid: boolean; reason?: string; allocationMinor: number; unresolvedMinor: number; conserved: boolean } {
  const allocationMinor = input.existingAllocations.reduce((total, entry) => total + entry.amountMinor, 0) + input.candidateAmountMinor;
  const unresolvedMinor = Math.max(input.availableMinor - allocationMinor, 0);
  const duplicate = input.existingAllocations.some((entry) => {
    return (
      (input.settlementId && entry.settlementId === input.settlementId && input.bankEntryId && entry.bankEntryId === input.bankEntryId) ||
      (input.settlementId && entry.settlementId === input.settlementId && !input.bankEntryId)
    );
  });

  if (duplicate) {
    return { valid: false, reason: 'Duplicate claim or incompatible duplicate allocation.', allocationMinor, unresolvedMinor, conserved: false };
  }

  if (allocationMinor > input.availableMinor) {
    return { valid: false, reason: 'Allocation exceeds source availability.', allocationMinor, unresolvedMinor, conserved: false };
  }

  return {
    valid: true,
    allocationMinor,
    unresolvedMinor,
    conserved: true,
  };
}

export function validateCandidateRelationship(input: CandidateValidationInput): DeterministicValidationResult {
  const checks: ValidationIssue[] = [];
  const lineage = buildEvidenceLineage({
    sourceImportIds: [...(input.sourceImportIds ?? []), ...(input.sourceImportId ? [input.sourceImportId] : [])],
    sourceRecordIds: [...(input.sourceRecordIds ?? []), ...(input.sourceRecordId ? [input.sourceRecordId] : [])],
    evidenceIds: input.evidenceIds ?? [],
  });

  const knownSourceImportIds = new Set((input.knownSourceImportIds ?? []).filter(Boolean));
  const knownSourceRecordIds = new Set((input.knownSourceRecordIds ?? []).filter(Boolean));
  const knownEvidenceIds = new Set((input.knownEvidenceIds ?? []).filter(Boolean));

  if (!input.provider) {
    checks.push(createValidationIssue('identity', 'Relationship candidate is missing a provider identity.'));
  }

  if (!input.sourceImportId && !input.sourceImportIds?.length) {
    checks.push(createValidationIssue('provenance', 'Relationship candidate is missing source import lineage.'));
  }

  if (lineage.sourceImportIds.length > 0) {
    const missingImportIds = lineage.sourceImportIds.filter((id) => !knownSourceImportIds.has(id));
    if (missingImportIds.length > 0 && input.knownSourceImportIds?.length) {
      checks.push(createValidationIssue('provenance', `Referenced source import IDs do not exist: ${missingImportIds.join(', ')}`));
    }
  }

  if (!input.sourceRecordId && !(input.sourceRecordIds ?? []).length) {
    checks.push(createValidationIssue('provenance', 'Relationship candidate is missing source record lineage.'));
  }

  if (lineage.sourceRecordIds.length > 0 && input.knownSourceRecordIds?.length) {
    const missingRecordIds = lineage.sourceRecordIds.filter((id) => !knownSourceRecordIds.has(id));
    if (missingRecordIds.length > 0) {
      checks.push(createValidationIssue('provenance', `Referenced source record IDs do not exist: ${missingRecordIds.join(', ')}`));
    }
  }

  if (lineage.evidenceIds.length > 0 && input.knownEvidenceIds?.length) {
    const missingEvidenceIds = lineage.evidenceIds.filter((id) => !knownEvidenceIds.has(id));
    if (missingEvidenceIds.length > 0) {
      checks.push(createValidationIssue('provenance', `Referenced evidence IDs do not exist: ${missingEvidenceIds.join(', ')}`));
    }
  }

  if (!Number.isInteger(input.amountMinor ?? 0)) {
    checks.push(createValidationIssue('financial_consistency', 'Amount must be an integer minor-unit value.'));
  }

  if (input.amountMinor !== undefined && input.amountMinor < 0) {
    checks.push(createValidationIssue('financial_consistency', 'Amount cannot be negative.'));
  }

  const derivedEffect = Number.isInteger(input.financialEffectMinor)
    ? input.financialEffectMinor
    : (Number.isInteger(input.creditMinor) || Number.isInteger(input.debitMinor))
      ? (input.creditMinor ?? 0) - (input.debitMinor ?? 0)
      : 0;

  if (Number.isInteger(input.financialEffectMinor) && Number.isInteger(input.amountMinor) && input.amountMinor !== derivedEffect) {
    checks.push(createValidationIssue('financial_consistency', 'Candidate financial effect and amount are inconsistent.'));
  }

  if (input.transactionDate && input.settlementDate) {
    const txTime = Date.parse(input.transactionDate);
    const settlementTime = Date.parse(input.settlementDate);
    if (!Number.isNaN(txTime) && !Number.isNaN(settlementTime) && settlementTime < txTime) {
      checks.push(createValidationIssue('temporal_consistency', 'Settlement date precedes transaction date.'));
    }
  }

  if (input.postedAt && input.settlementDate) {
    const bankTime = Date.parse(input.postedAt);
    const settlementTime = Date.parse(input.settlementDate);
    if (!Number.isNaN(bankTime) && !Number.isNaN(settlementTime) && bankTime < settlementTime) {
      checks.push(createValidationIssue('temporal_consistency', 'Bank entry precedes settlement date.'));
    }
  }

  if (input.existingClaims?.length) {
    const claimed = input.existingClaims.reduce((total, claim) => total + (claim.amountMinor ?? 0), 0);
    const sourceLimit = input.availableMinor ?? input.allocatedMinor ?? 0;
    if (sourceLimit && claimed > sourceLimit) {
      checks.push(createValidationIssue('allocation_limit', 'Allocation exceeds source availability.'));
    }
    const duplicate = new Set(input.existingClaims.map((claim) => claim.sourceRecordId ?? claim.id ?? '')).size !== input.existingClaims.length;
    if (duplicate) {
      checks.push(createValidationIssue('uniqueness', 'Duplicate claim detected for the same source record.'));
    }
  }

  const allocationMinor = input.allocatedMinor ?? input.existingClaims?.reduce((total, claim) => total + claim.amountMinor, 0) ?? 0;
  const sourceLimit = input.availableMinor ?? Math.max(0, input.amountMinor ?? 0);
  const unresolvedMinor = Math.max(sourceLimit - allocationMinor, 0);
  const conserved = allocationMinor <= sourceLimit;

  if (!conserved) {
    checks.push(createValidationIssue('conservation', 'Allocation exceeds available source value.'));
  }

  if (input.currentState === 'VERIFIED' && input.expectedState !== 'VERIFIED') {
    checks.push(createValidationIssue('state_consistency', 'Current candidate state is inconsistent with expected verified state.'));
  }

  const valid = checks.length === 0;

  return {
    status: valid ? 'VERIFIED' : 'REJECTED',
    canBecomeVerified: valid,
    evidenceIds: lineage.evidenceIds,
    sourceImportIds: lineage.sourceImportIds,
    sourceRecordIds: lineage.sourceRecordIds,
    allocationMinor,
    unresolvedMinor,
    conserved,
    checks,
  };
}

export function buildProofView(input: {
  caseId: string;
  caseType: 'TRANSACTION_SETTLEMENT' | 'SETTLEMENT_BANK';
  machineState: string;
  machineReason?: string | null;
  sourceEvidence?: string[];
  candidate?: Record<string, unknown> | null;
  validationChecks?: ValidationIssue[];
  evidenceFound?: string[];
  evidenceMissing?: string[];
  auditTrail?: unknown[];
  actionTrace?: unknown[];
  finalState?: string;
  reason?: string | null;
  humanReview?: {
    required?: boolean;
    reason?: string;
    comment?: string;
    reviewedBy?: string;
  };
}): ProofView {
  return {
    caseId: input.caseId,
    caseType: input.caseType,
    machineState: input.machineState,
    machineReason: input.machineReason ?? null,
    sourceEvidence: input.sourceEvidence ?? [],
    candidate: input.candidate ?? null,
    validationChecks: input.validationChecks ?? [],
    evidenceFound: input.evidenceFound ?? [],
    evidenceMissing: input.evidenceMissing ?? [],
    auditTrail: input.auditTrail ?? [],
    actionTrace: input.actionTrace ?? [],
    finalState: input.finalState ?? input.machineState,
    reason: input.reason ?? input.machineReason ?? null,
    humanReview: {
      required: input.humanReview?.required ?? false,
      reason: input.humanReview?.reason,
      comment: input.humanReview?.comment,
      reviewedBy: input.humanReview?.reviewedBy,
    },
  };
}

export function createHumanResolutionDecision(input: {
  caseId: string;
  originalMachineState: string;
  originalMachineReason?: string | null;
  reason: string;
  comment: string;
  reviewedBy?: string;
  overrideState?: 'PENDING' | 'RESOLVED' | 'ESCALATED';
}): HumanResolutionResult {
  const humanState = input.overrideState ?? (input.originalMachineState === 'PENDING' ? 'PENDING' : 'ESCALATED');
  const didOverwriteMachineDecision = humanState !== input.originalMachineState;

  return {
    caseId: input.caseId,
    originalMachineState: input.originalMachineState,
    originalMachineReason: input.originalMachineReason ?? null,
    humanState,
    reason: input.reason,
    comment: input.comment,
    reviewedBy: input.reviewedBy,
    didOverwriteMachineDecision,
  };
}

export function appendAuditEvent<T>(existing: T[], event: T): T[] {
  return [...existing, event];
}

export const runDeterministicValidation = validateCandidateRelationship;
export const deterministicValidationGate = validateCandidateRelationship;
export const buildEvidenceProof = buildProofView;
export const humanReviewDecision = createHumanResolutionDecision;
export const enforceAllocationGuard = validateAllocationWriteGuard;
