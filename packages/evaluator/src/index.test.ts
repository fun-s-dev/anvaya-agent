import { describe, expect, it } from 'vitest';

import { type LlmProvider } from '@anvaya/agent';
import { generateScenario } from '@anvaya/generator';

import {
  buildMarkdownReport,
  evaluateFixedBenchmark,
  evaluateScenario,
  evaluateScenarioSuite,
} from './index.js';

describe('evaluation harness', () => {
  it('keeps clean scenarios deterministic with 0 LLM calls', async () => {
    const scenario = generateScenario({ seed: 7, size: 50, profile: 'clean' });
    const result = await evaluateScenario(scenario);

    expect(result.difficulty).toBe('clean');
    expect(result.mode).toBe('deterministic');
    expect(result.llmCallCount).toBe(0);
    expect(result.modelMetadata.provider).toBe('deterministic');
  });

  it('marks ambiguous scenarios as llm-assisted only when the mock agent actually executes', async () => {
    const scenario = generateScenario({
      seed: 42,
      size: 100,
      profile: 'adversarial',
      mutations: ['ambiguous_reference'],
    });

    const mockProvider: LlmProvider = {
      generateStructuredAction: async <T>() => ({
        next_action: 'MATCH_EXACT',
        transaction_ids: ['tx1'],
        psp_transaction_ids: ['psp1'],
        evidence_ids: ['tx1', 'psp1'],
      }) as T,
    };

    const result = await evaluateScenario(scenario, {}, { llmProvider: mockProvider, batchRecordCount: scenario.config.size });
    expect(result.difficulty).toBe('adversarial');
    expect(result.mode).toBe('llm-assisted');
    expect(result.llmCallCount).toBeGreaterThan(0);
    expect(result.modelMetadata.provider).toBe('mock-provider');
  });

  it('falls back to deterministic escalation when the provider is unavailable', async () => {
    const scenario = generateScenario({
      seed: 42,
      size: 100,
      profile: 'adversarial',
      mutations: ['bank_timing_delay'],
    });

    const result = await evaluateScenario(scenario, {}, { llmProvider: null, batchRecordCount: scenario.config.size });
    expect(result.mode).toBe('deterministic');
    expect(result.llmCallCount).toBe(0);
    expect(['PENDING', 'ESCALATED', 'VERIFIED']).toContain(result.predictedFinalState);
  });

  it('does not infer llm-assisted mode from mutations alone', async () => {
    const scenario = generateScenario({
      seed: 42,
      size: 100,
      profile: 'adversarial',
      mutations: ['settlement_component_integrity_break'],
    });

    const result = await evaluateScenario(scenario);
    expect(result.difficulty).toBe('adversarial');
    expect(result.mode).toBe('deterministic');
    expect(result.llmCallCount).toBe(0);
  });

  it('checks evidence-link accuracy against hidden expected source evidence', async () => {
    const scenario = generateScenario({ seed: 99, size: 500, profile: 'clean' });
    const result = await evaluateScenario(scenario);

    expect(result.metrics.evidenceLinkAccuracy).toBeGreaterThanOrEqual(0);
    expect(result.metrics.evidenceLinkAccuracy).toBeLessThanOrEqual(1);
    expect(result.details.evidenceExpected).toBe(scenario.hiddenTruth.expectedEvidenceSourceLinks.length);
    expect(result.details.evidenceMatches).toBeGreaterThanOrEqual(0);
  });

  it('keeps false VERIFIED detection active when the hidden truth is pending', async () => {
    const scenario = generateScenario({ seed: 7, size: 50, profile: 'clean' });
    const validScenario = {
      ...scenario,
      operationalRecords: {
        ...scenario.operationalRecords,
        bankEntries: scenario.operationalRecords.bankEntries.map((entry) => ({
          ...entry,
          postedAt: '2026-08-12T10:00:00.000Z',
        })),
      },
      hiddenTruth: {
        ...scenario.hiddenTruth,
        expectedFinalState: 'PENDING' as const,
        expectedReason: 'AMBIGUOUS_REFERENCE',
      },
    };

    const result = await evaluateScenario(validScenario, {}, { llmProvider: null });
    expect(result.predictedFinalState).toBe('VERIFIED');
    expect(result.hiddenTruthFinalState).toBe('PENDING');
    expect(result.metrics.falseResolutionRate).toBe(1);
  });

  it('builds a machine-readable report and a markdown report from the benchmark suite', async () => {
    const report = await evaluateFixedBenchmark();
    expect(report.cases.length).toBeGreaterThanOrEqual(4);
    expect(JSON.parse(report.jsonReport)).toHaveProperty('summary');
    const markdown = buildMarkdownReport(report);
    expect(markdown).toContain('Anvaya Evaluation Report');
    expect(markdown).toContain('Transaction → settlement match rate');
  });

  it('keeps the benchmark suite reproducible across fixed seed selections', async () => {
    const first = await evaluateScenarioSuite([
      { seed: 7, size: 50, profile: 'clean' },
      { seed: 42, size: 100, profile: 'adversarial' },
      { seed: 99, size: 500, profile: 'clean' },
      { seed: 2024, size: 500, profile: 'adversarial' },
    ]);
    const second = await evaluateScenarioSuite([
      { seed: 7, size: 50, profile: 'clean' },
      { seed: 42, size: 100, profile: 'adversarial' },
      { seed: 99, size: 500, profile: 'clean' },
      { seed: 2024, size: 500, profile: 'adversarial' },
    ]);
    expect(first.summary).toEqual(second.summary);
    expect(first.cases.map((item) => item.scenarioId)).toEqual(second.cases.map((item) => item.scenarioId));
  });
});
