import { describe, expect, it } from 'vitest';

import {
  createActionDecision,
  determineNextAction,
  getAllowedActions,
  requestAgentAction,
  resolveAgentCase,
  runAgentActionLoop,
  shouldBypassLlm,
  validateActionPolicy,
  type AgentCaseContext,
  type LlmProvider,
} from './index.js';

describe('agent controller', () => {
  const baseContext: AgentCaseContext = {
    caseId: 'CASE-100',
    caseType: 'SETTLEMENT_BANK',
    state: 'INVESTIGATING',
    reason: 'AMBIGUOUS_REFERENCE',
    actionCount: 0,
    llmCallCount: 0,
    runLlmCallCount: 0,
    evidence: {
      tx1: { id: 'tx1', type: 'transaction' },
      psp1: { id: 'psp1', type: 'psp' },
      bank1: { id: 'bank1', type: 'bank' },
    },
    availableActions: ['MATCH_EXACT', 'MATCH_COMPOSITE', 'MATCH_AGGREGATE', 'CHECK_TIMING', 'ESCALATE'],
    batchRecordCount: 100,
  };

  it('bypasses the LLM for clean cases', () => {
    expect(shouldBypassLlm({ reason: null, state: 'RESOLVED', actionCount: 0 })).toBe(true);
    expect(shouldBypassLlm({ reason: 'AMBIGUOUS_REFERENCE', state: 'INVESTIGATING', actionCount: 0 })).toBe(false);
  });

  it('resolves a one-call ambiguity path', async () => {
    const provider: LlmProvider = {
      generateStructuredAction: async <T>() => ({
        next_action: 'MATCH_EXACT',
        transaction_ids: ['tx1'],
        psp_transaction_ids: ['psp1'],
        evidence_ids: ['tx1', 'psp1'],
      }) as T,
    };

    const result = await requestAgentAction(provider, baseContext);
    expect(result?.nextAction.next_action).toBe('MATCH_EXACT');
    expect(result?.validationResult).toBe('valid');
  });

  it('supports a two-call investigation flow', async () => {
    const responses = [
      { next_action: 'MATCH_COMPOSITE', transaction_ids: ['tx1'], candidate_ids: ['psp1'], evidence_ids: ['tx1', 'psp1'] },
      { next_action: 'VALIDATE_CANDIDATE', relationship_type: 'TRANSACTION_SETTLEMENT', candidate_ids: ['psp1'], amount_minor: 1000, currency: 'INR', evidence_ids: ['tx1', 'psp1'] },
    ];
    const provider: LlmProvider = {
      generateStructuredAction: async <T>() => ((responses.shift() ?? { next_action: 'ESCALATE', reason: 'AMBIGUOUS_REFERENCE', required_evidence_ids: ['tx1', 'psp1'] }) as T),
    };

    const first = await requestAgentAction(provider, baseContext);
    expect(first?.nextAction.next_action).toBe('MATCH_COMPOSITE');

    const secondContext: AgentCaseContext = { ...baseContext, actionCount: 1, llmCallCount: 1, runLlmCallCount: 1, availableActions: ['VALIDATE_CANDIDATE', 'ESCALATE'] };
    const second = await requestAgentAction(provider, secondContext);
    expect(second?.nextAction.next_action).toBe('VALIDATE_CANDIDATE');
  });

  it('enforces action budget exhaustion by reserving ESCALATE at action #6', () => {
    const context: AgentCaseContext = { ...baseContext, actionCount: 5, state: 'INVESTIGATING' };
    expect(getAllowedActions(context)).toEqual(['ESCALATE']);
    expect(
      validateActionPolicy(context, {
        next_action: 'MATCH_EXACT',
        transaction_ids: ['tx1'],
        psp_transaction_ids: ['psp1'],
      }),
    ).toMatchObject({ valid: false });
  });

  it('disables LLM actions when the per-run LLM budget is exhausted', () => {
    const context: AgentCaseContext = { ...baseContext, runLlmCallCount: 20, llmCallCount: 2, availableActions: ['MATCH_EXACT', 'ESCALATE'] };
    expect(getAllowedActions(context)).toEqual(['ESCALATE']);
  });

  it('fails closed on provider timeouts and errors', async () => {
    const provider: LlmProvider = {
      generateStructuredAction: async () => {
        throw new Error('timeout');
      },
    };

    const result = await requestAgentAction(provider, baseContext);
    expect(result?.stateAfter).toBe('ESCALATED');
    expect(result?.nextAction.next_action).toBe('ESCALATE');
    expect(result?.metadata?.validation_result).toBe('timeout');
  });

  it('treats invalid structured output as infrastructure failure', async () => {
    const provider: LlmProvider = {
      generateStructuredAction: async () => ({ nonsense: true } as never),
    };

    const result = await requestAgentAction(provider, baseContext);
    expect(result?.nextAction.next_action).toBe('ESCALATE');
    expect(result?.validationResult).toBe('invalid');
  });

  it('rejects illegal action policy before any execution', () => {
    const context: AgentCaseContext = { ...baseContext, actionCount: 1, llmCallCount: 1, runLlmCallCount: 1 };
    const result = validateActionPolicy(context, {
      next_action: 'MATCH_EXACT',
      transaction_ids: [],
      psp_transaction_ids: [],
    });
    expect(result.valid).toBe(false);
  });

  it('keeps the terminal action as the only legal action at the last step', () => {
    const context: AgentCaseContext = { ...baseContext, actionCount: 5, state: 'INVESTIGATING', availableActions: ['ESCALATE'] };
    expect(determineNextAction(context)).toBe('ESCALATE');
    expect(createActionDecision(context, { next_action: 'ESCALATE', reason: 'AMBIGUOUS_REFERENCE', required_evidence_ids: ['tx1'] }).action?.next_action).toBe('ESCALATE');
  });

  it('supports direct controller resolution for an ambiguous case', async () => {
    const provider: LlmProvider = {
      generateStructuredAction: async <T>() => ({
        next_action: 'MATCH_EXACT',
        transaction_ids: ['tx1'],
        psp_transaction_ids: ['psp1'],
        evidence_ids: ['tx1', 'psp1'],
      }) as T,
    };

    const result = await resolveAgentCase(baseContext, provider);
    expect(result.finalState).toBe('INVESTIGATING');
    expect(result.actionTrace[0]?.next_action).toBe('MATCH_EXACT');
  });

  it('runs the explicit observe -> choose -> execute -> observe loop', async () => {
    const provider: LlmProvider = {
      generateStructuredAction: async <T>() => ({
        next_action: 'MATCH_EXACT',
        transaction_ids: ['tx1'],
        psp_transaction_ids: ['psp1'],
        evidence_ids: ['tx1', 'psp1'],
      }) as T,
    };

    const loop = await runAgentActionLoop(baseContext, provider);
    expect(loop.steps).toEqual(['OBSERVE', 'CHOOSE_ACTION', 'EXECUTE_TOOL', 'OBSERVE_RESULT']);
    expect(loop.nextAction?.next_action).toBe('MATCH_EXACT');
    expect(loop.finalState).toBe('INVESTIGATING');
  });
});
