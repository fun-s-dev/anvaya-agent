import { describe, expect, it } from 'vitest';

import { createActionDecision, type AgentCaseContext } from '@anvaya/agent';

import {
  appendAuditEvent,
  appendCanonicalFinancialEffect,
  buildEvidenceLineage,
  buildProofView,
  createCanonicalFinancialEffect,
  createHumanResolutionDecision,
  validateAllocationWriteGuard,
  validateCandidateRelationship,
} from './index.js';

describe('canonical financial effect uniqueness', () => {
  it('rejects duplicate canonical financial effects for the same stable source record', () => {
    const candidate = createCanonicalFinancialEffect({
      provider: 'razorpay',
      sourceType: 'psp',
      sourceRecordId: 'pay_123',
      amountMinor: 1000,
      currency: 'INR',
      financialEffectMinor: 1000,
    });

    const existing = [candidate];

    expect(() => appendCanonicalFinancialEffect(existing, candidate)).toThrow(
      /Duplicate canonical financial effect/i,
    );
  });

  it('allows distinct source records to coexist', () => {
    const first = createCanonicalFinancialEffect({
      provider: 'razorpay',
      sourceType: 'psp',
      sourceRecordId: 'pay_123',
      amountMinor: 1000,
      currency: 'INR',
      financialEffectMinor: 1000,
    });

    const second = createCanonicalFinancialEffect({
      provider: 'razorpay',
      sourceType: 'psp',
      sourceRecordId: 'pay_456',
      amountMinor: 2000,
      currency: 'INR',
      financialEffectMinor: 2000,
    });

    expect(appendCanonicalFinancialEffect([first], second)).toEqual([first, second]);
  });

  it('validates candidate relationships and preserves provenance', () => {
    const result = validateCandidateRelationship({
      caseId: 'CASE-101',
      caseType: 'SETTLEMENT_BANK',
      provider: 'razorpay',
      sourceImportId: 'import-1',
      sourceRecordId: 'source-1',
      evidenceIds: ['evidence-1'],
      amountMinor: 1200,
      financialEffectMinor: 1200,
      availableMinor: 1200,
      allocatedMinor: 1200,
      currentState: 'INVESTIGATING',
      expectedState: 'VERIFIED',
    });

    expect(result.status).toBe('VERIFIED');
    expect(result.sourceImportIds).toEqual(['import-1']);
    expect(result.sourceRecordIds).toEqual(['source-1']);
  });

  it('blocks over-allocation and duplicate claims with explicit unresolved value', () => {
    const guard = validateAllocationWriteGuard({
      existingAllocations: [{ settlementId: 'set-1', bankEntryId: 'bank-1', amountMinor: 500 }],
      candidateAmountMinor: 700,
      availableMinor: 1000,
      settlementId: 'set-1',
      bankEntryId: 'bank-1',
    });

    expect(guard.valid).toBe(false);
    expect(guard.reason).toMatch(/Duplicate claim|Allocation exceeds source availability/i);
    expect(guard.unresolvedMinor).toBe(0);
    expect(guard.conserved).toBe(false);
  });

  it('builds proof data and human resolution outcomes without silent overwrite', () => {
    const proof = buildProofView({
      caseId: 'CASE-44',
      caseType: 'TRANSACTION_SETTLEMENT',
      machineState: 'ESCALATED',
      machineReason: 'AMBIGUOUS_REFERENCE',
      evidenceFound: ['tx-1'],
      evidenceMissing: ['settlement-1'],
      auditTrail: [{ eventType: 'AI_INFRA_FAILURE' }],
      actionTrace: [{ actionName: 'CHECK_TIMING' }],
      humanReview: { required: true, reason: 'Missing settlement evidence', reviewedBy: 'ops-user' },
    });

    expect(proof.humanReview.required).toBe(true);
    expect(proof.evidenceMissing).toContain('settlement-1');

    const resolution = createHumanResolutionDecision({
      caseId: 'CASE-44',
      originalMachineState: 'ESCALATED',
      originalMachineReason: 'AMBIGUOUS_REFERENCE',
      reason: 'Missing settlement evidence',
      comment: 'Reviewed by ops-user after matching the bank trace.',
      reviewedBy: 'ops-user',
      overrideState: 'PENDING',
    });

    expect(resolution.didOverwriteMachineDecision).toBe(true);
    expect(resolution.humanState).toBe('PENDING');
  });

  it('rejects a fake but plausible AI proposal when referenced provenance does not exist', () => {
    const context: AgentCaseContext = {
      caseId: 'CASE-FAKE-AI',
      caseType: 'SETTLEMENT_BANK',
      state: 'INVESTIGATING',
      reason: 'AMBIGUOUS_REFERENCE',
      actionCount: 0,
      llmCallCount: 0,
      runLlmCallCount: 0,
      evidence: {
        tx1: { id: 'tx1', type: 'transaction' },
        settlementA: { id: 'settlementA', type: 'settlement' },
        bankCandidate: { id: 'bankCandidate', type: 'bank' },
      },
      availableActions: ['MATCH_AGGREGATE', 'VALIDATE_CANDIDATE', 'ESCALATE'],
      batchRecordCount: 100,
    };

    const llmProposal = {
      next_action: 'VALIDATE_CANDIDATE',
      relationship_type: 'SETTLEMENT_BANK',
      candidate_ids: ['candidate-404'],
      amount_minor: 5500,
      currency: 'INR',
      evidence_ids: ['evidence-404'],
    } as const;

    const decision = createActionDecision(context, llmProposal);
    expect(decision.validationResult).toBe('valid');
    expect(decision.action?.next_action).toBe('VALIDATE_CANDIDATE');

    const validation = validateCandidateRelationship({
      caseId: 'CASE-FAKE-AI',
      caseType: 'SETTLEMENT_BANK',
      provider: 'razorpay',
      sourceImportId: 'import-404',
      sourceRecordId: 'settlement_ref_404',
      evidenceIds: ['evidence-404'],
      amountMinor: 5500,
      financialEffectMinor: 5500,
      currentState: 'INVESTIGATING',
      expectedState: 'VERIFIED',
      knownSourceImportIds: ['import-actual-1'],
      knownSourceRecordIds: ['settlement_ref_actual_1'],
      knownEvidenceIds: ['evidence-actual-1'],
    });

    expect(validation.status).toBe('REJECTED');
    expect(validation.canBecomeVerified).toBe(false);
    expect(validation.status).not.toBe('VERIFIED');
    expect(validation.checks.some((check) => check.check === 'provenance')).toBe(true);
    expect(validation.checks.some((check) => /do not exist/i.test(check.message))).toBe(true);
  });

  it('rejects a valid-shaped but unproven candidate before any verified relationship is marked', () => {
    const result = validateCandidateRelationship({
      caseId: 'CASE-INVALID-PROVENANCE',
      caseType: 'TRANSACTION_SETTLEMENT',
      provider: 'razorpay',
      sourceImportId: 'import-missing',
      sourceRecordId: 'ref-missing',
      evidenceIds: ['evidence-missing'],
      amountMinor: 1200,
      financialEffectMinor: 1200,
      currentState: 'INVESTIGATING',
      expectedState: 'VERIFIED',
      knownSourceImportIds: ['import-real'],
      knownSourceRecordIds: ['ref-real'],
      knownEvidenceIds: ['evidence-real'],
    });

    expect(result.status).toBe('REJECTED');
    expect(result.canBecomeVerified).toBe(false);
    expect(result.status).not.toBe('VERIFIED');
    expect(result.checks.some((check) => check.check === 'provenance')).toBe(true);
  });

  it('supports audit append-only trace creation', () => {
    expect(appendAuditEvent([{ eventType: 'CASE_OPENED' }], { eventType: 'CASE_ESCALATED' })).toEqual([
      { eventType: 'CASE_OPENED' },
      { eventType: 'CASE_ESCALATED' },
    ]);
    expect(buildEvidenceLineage({ sourceImportIds: ['imp-1', 'imp-1'], sourceRecordIds: ['rec-1', 'rec-2'], evidenceIds: ['ev-1'] }).sourceImportIds).toEqual(['imp-1']);
  });
});
