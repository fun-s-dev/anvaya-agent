import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../server.js';
import { memoryStore } from '../lib/demo.js';

describe('run intelligence endpoints', () => {
  const previous = process.env.ANVAYA_DEMO_STORE;
  beforeEach(() => { process.env.ANVAYA_DEMO_STORE = 'memory'; memoryStore.reset(); });
  afterEach(() => { if (previous === undefined) delete process.env.ANVAYA_DEMO_STORE; else process.env.ANVAYA_DEMO_STORE = previous; });

  it('grounds Ask Anvaya and isolates run cases without mutation', async () => {
    const app = await buildServer();
    await app.inject({ method: 'POST', url: '/demo/generate' });
    const first = (await app.inject({ method: 'POST', url: '/reconciliation/runs' })).json();
    const before = JSON.stringify(memoryStore.runs.get(first.runId));
    const ask = await app.inject({ method: 'POST', url: '/ask-anvaya', payload: { runId: first.runId, question: 'variance' } });
    expect(ask.statusCode).toBe(200);
    expect(ask.json().runId).toBe(first.runId);
    expect(ask.json().readOnly).toBe(true);
    expect(JSON.stringify(memoryStore.runs.get(first.runId))).toBe(before);
    const scoped = await app.inject({ method: 'GET', url: `/runs/${first.runId}/cases` });
    expect(scoped.json().runId).toBe(first.runId);
    const variance = await app.inject({ method: 'GET', url: `/runs/${first.runId}/variance` });
    expect(variance.json()).toMatchObject({ caseCount: expect.any(Number), drivers: expect.any(Array), requiredNextEvidence: expect.any(Array) });
    const alias = await app.inject({ method: 'POST', url: `/reconciliation/runs/${first.runId}/ask`, payload: { question: 'how much remains unresolved?' } });
    expect(alias.json().answer).toContain('unresolved');
    await app.close();
  });

  it('does NOT expose a global unauthenticated run listing (privacy requirement)', async () => {
    const app = await buildServer();
    await app.inject({ method: 'POST', url: '/demo/generate' });
    await app.inject({ method: 'POST', url: '/reconciliation/runs' });
    await app.inject({ method: 'POST', url: '/reconciliation/runs' });

    // The global listing endpoints must NOT be registered — no-auth product must never
    // expose all users' historical runs.
    const list1 = await app.inject({ method: 'GET', url: '/runs' });
    const list2 = await app.inject({ method: 'GET', url: '/reconciliation/runs' });
    expect(list1.statusCode).toBe(404);
    expect(list2.statusCode).toBe(404);
    await app.close();
  });

  it('cross-run case proof is properly isolated by run scope', async () => {
    const app = await buildServer();
    await app.inject({ method: 'POST', url: '/demo/generate' });
    const first = (await app.inject({ method: 'POST', url: '/reconciliation/runs' })).json();
    const second = (await app.inject({ method: 'POST', url: '/reconciliation/runs' })).json();
    const scoped = await app.inject({ method: 'GET', url: `/runs/${first.runId}/cases` });
    const firstCaseId = scoped.json().data[0]?.id;
    if (firstCaseId) {
      // Attempting to access a case from run1 under run2's scope must return 404.
      const cross = await app.inject({ method: 'GET', url: `/runs/${second.runId}/cases/${firstCaseId}/proof` });
      expect(cross.statusCode).toBe(404);
    }
    await app.close();
  });
});
