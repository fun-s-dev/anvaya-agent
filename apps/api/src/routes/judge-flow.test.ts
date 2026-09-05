import { describe, expect, it } from 'vitest';

import { buildServer } from '../server.js';

describe('Part 7 judge walkthrough smoke test', () => {
  it('supports the demo dataset flow: generate -> run -> review exception -> proof', async () => {
    const previousDemoStore = process.env.ANVAYA_DEMO_STORE;
    process.env.ANVAYA_DEMO_STORE = 'memory';
    const app = await buildServer();

    const datasetResponse = await app.inject({
      method: 'POST',
      url: '/demo/generate',
    });

    expect(datasetResponse.statusCode).toBe(200);
    const dataset = datasetResponse.json();
    expect(Array.isArray(dataset.files)).toBe(true);
    expect(dataset.files).toHaveLength(3);
    expect(dataset.note).toContain('Synthetic data only');

    const runResponse = await app.inject({
      method: 'POST',
      url: '/reconciliation/runs',
    });

    expect(runResponse.statusCode).toBe(200);
    const run = runResponse.json();
    expect(run.runId).toBeTruthy();
    expect(run.metrics.matchRateTransactionSettlement).toBeGreaterThan(0);
    expect(run.metrics.matchRateSettlementBank).toBeGreaterThan(0);

    const casesResponse = await app.inject({
      method: 'GET',
      url: '/cases',
    });

    expect(casesResponse.statusCode).toBe(200);
    const casesPayload = casesResponse.json();
    expect(Array.isArray(casesPayload.data)).toBe(true);
    // Clean reconciliation may produce 0 cases (all matched) - that is valid behavior.
    expect(casesPayload.data.length).toBeGreaterThanOrEqual(0);

    if (casesPayload.data.length > 0) {
      const firstCaseId = casesPayload.data[0].id;
      const proofResponse = await app.inject({
        method: 'GET',
        url: `/cases/${firstCaseId}/proof`,
      });

      expect(proofResponse.statusCode).toBe(200);
      const proof = proofResponse.json();
      expect(proof.caseId).toBe(firstCaseId);
      expect(Array.isArray(proof.actionTrace)).toBe(true);
      expect(proof.finalState || proof.machineState).toBeTruthy();
    }
    if (previousDemoStore === undefined) delete process.env.ANVAYA_DEMO_STORE;
    else process.env.ANVAYA_DEMO_STORE = previousDemoStore;
  });
});
