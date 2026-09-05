import { describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { getConfiguredLlmProvider } from './run-orchestrator.js';

describe('Run Metrics & LLM Truth Audit', () => {
  it('calculates verified value and correctly handles LLM usage', async () => {
    process.env.GEMINI_API_KEY = ''; // Force mock provider for fast tests
    const app = await buildServer();

    // 1. Clean Scenario
    const cleanGen = await app.inject({ method: 'POST', url: '/demo/generate', payload: { scenario: 'Clean Reconciliation' } });
    const cleanImportIds = cleanGen.json().importIds;
    
    const cleanRun = await app.inject({ method: 'POST', url: '/reconciliation/runs', payload: { import_ids: cleanImportIds } });
    const cleanMetrics = cleanRun.json().metrics;
    
    expect(cleanMetrics.verifiedValueMinor).toBeGreaterThan(0);
    expect(cleanMetrics.llmCallsUsed).toBe(0);
    expect(cleanMetrics.unresolvedValueMinor).toBe(0);

    // 2. Amount Mismatch Scenario
    const mismatchGen = await app.inject({ method: 'POST', url: '/demo/generate', payload: { scenario: 'Amount Mismatch' } });
    const mismatchImportIds = mismatchGen.json().importIds;
    
    const mismatchRun = await app.inject({ method: 'POST', url: '/reconciliation/runs', payload: { import_ids: mismatchImportIds } });
    const mismatchMetrics = mismatchRun.json().metrics;
    
    expect(mismatchMetrics.unresolvedValueMinor).toBe(137);
    expect(mismatchMetrics.caseCount).toBe(1);
    
    const provider = getConfiguredLlmProvider();
    if (provider.modelProvider === 'mock-provider') {
      expect(mismatchMetrics.llmCallsUsed).toBe(0);
    } else {
      expect(mismatchMetrics.llmCallsUsed).toBe(1);
    }

    expect(mismatchMetrics.llmProvider).toBeDefined();
    expect(mismatchMetrics.llmBudget).toBeDefined();
    expect(mismatchMetrics.llmBudget).toBeGreaterThanOrEqual(5);
  });
});
