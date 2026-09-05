import type { FastifyInstance } from 'fastify';

import { HumanResolutionRequestSchema } from '@anvaya/contracts';

import { prisma } from '../lib/prisma.js';
import { memoryStore, useMemoryStore } from '../lib/demo.js';
import { deriveVarianceIntelligence } from '../lib/variance-intelligence.js';
import { parseIntent, executeIntent } from '../lib/ask-anvaya.js';

export async function casesRoutes(fastify: FastifyInstance) {
  fastify.get('/cases', async (request, reply) => {
    const requestedRunId = typeof (request.query as { runId?: unknown }).runId === 'string'
      ? (request.query as { runId: string }).runId : undefined;
    if (useMemoryStore()) {
      const run = memoryStore.runs.get(requestedRunId ?? memoryStore.activeRunId ?? '');
      const data = run?.cases ?? [];
      return { data, total: data.length, runId: run?.runId, generatedAt: new Date().toISOString() };
    }
    if (!process.env.DATABASE_URL) return reply.code(503).send({ error: 'Database unavailable' });
    const latestRun = requestedRunId
      ? await prisma.reconciliationRun.findUnique({ where: { id: requestedRunId } })
      : await prisma.reconciliationRun.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!latestRun) return { data: [], total: 0, runId: undefined, generatedAt: new Date().toISOString() };
    const records = await prisma.case.findMany({ where: { runId: latestRun.id }, orderBy: { createdAt: 'asc' } });
    return { data: records.map((record) => {
      const evidence = (record.evidence as Record<string, unknown> | null) ?? {};
      return { id: record.id, caseType: record.caseType, state: record.state, reason: record.reason,
        priority: record.priority, amountMinor: typeof evidence.amountMinor === 'number' ? evidence.amountMinor : 0,
        evidenceFound: Array.isArray(evidence.sourceEvidence) ? evidence.sourceEvidence : [],
        evidenceRequired: Array.isArray(evidence.evidenceMissing) ? evidence.evidenceMissing : [] };
    }), total: records.length, generatedAt: new Date().toISOString() };
  });

  fastify.get('/cases/:id', async (request) => {
    const params = request.params as { id: string };
    if (!useMemoryStore()) {
      if (!process.env.DATABASE_URL) throw new Error('Database unavailable');
      const record = await prisma.case.findUnique({ where: { id: params.id }, include: { agentActions: true } });
      if (!record) return { error: 'Case not found' };
      return { ...record, agentActions: record.agentActions };
    }
    const run = memoryStore.activeRunId ? memoryStore.runs.get(memoryStore.activeRunId) : undefined;
    const record = run?.cases.find((item) => item.id === params.id);
    return record ? { ...record, agentActions: [], evidence: { sourceEvidence: record.evidenceFound } } : { error: 'Case not found' };
  });

  fastify.get('/audit/:entityId', async (request) => {
    const params = request.params as { entityId: string };
    return {
      entityId: params.entityId,
      events: [
        {
          eventType: 'VALIDATION',
          summary: 'Deterministic validation passed for supported match',
          createdAt: new Date().toISOString(),
        },
      ],
    };
  });

  fastify.get('/sources/:id', async (request) => {
    const params = request.params as { id: string };
    return {
      sourceId: params.id,
      provider: 'razorpay',
      sourceType: 'bank',
      lineage: ['merchant_transactions.csv', 'settlement_records.csv', 'bank_statement.csv'],
    };
  });

  fastify.get('/cases/:id/proof', async (request, reply) => {
    const params = request.params as { id: string };
    const requestedRunId = typeof (request.query as { runId?: unknown }).runId === 'string'
      ? (request.query as { runId: string }).runId : undefined;
    if (useMemoryStore()) {
      const run = memoryStore.runs.get(requestedRunId ?? memoryStore.activeRunId ?? '');
      const proof = run?.proofs[params.id];
      return proof ? reply.code(200).send(proof) : reply.code(404).send({ error: 'Case not found' });
    }

    if (!process.env.DATABASE_URL) return reply.code(503).send({ error: 'Database unavailable' });

    try {
      const caseRecord = await prisma.case.findUnique({
        where: { id: params.id },
        include: {
          agentActions: true,
          auditEvents: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!caseRecord) {
        return reply.code(404).send({ error: 'Case not found' });
      }
      if (requestedRunId && caseRecord.runId !== requestedRunId) {
        return reply.code(404).send({ error: 'Case not found for run' });
      }

      const evidence = (caseRecord.evidence as Record<string, unknown> | null) ?? {};

      return {
        caseId: caseRecord.id,
        caseType: caseRecord.caseType,
        machineState: caseRecord.state,
        machineReason: caseRecord.reason,
        sourceEvidence: Array.isArray(evidence.sourceEvidence) ? (evidence.sourceEvidence as string[]) : [],
        candidate: (evidence.candidate as Record<string, unknown> | null) ?? null,
        validationChecks: Array.isArray(evidence.validationChecks) ? (evidence.validationChecks as Array<Record<string, unknown>>) : [],
        finalState: caseRecord.state,
        reason: caseRecord.reason,
        evidenceFound: (evidence.evidenceFound as string[]) ?? [],
        evidenceMissing: (evidence.evidenceMissing as string[]) ?? [],
        auditTrail: caseRecord.auditEvents.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          eventSummary: event.eventSummary,
          payload: event.payload,
          createdAt: event.createdAt.toISOString(),
        })),
        actionTrace: caseRecord.agentActions.map((action) => ({
          id: action.id,
          actionName: action.actionName,
          actionOrder: action.actionOrder,
          status: action.status,
          payload: action.payload,
          result: action.result,
          createdAt: action.createdAt.toISOString(),
        })),
        humanReview: {
          required: Boolean(evidence.humanReviewRequired),
          reason: (evidence.humanReviewReason as string | undefined) ?? undefined,
          comment: (evidence.humanReviewComment as string | undefined) ?? undefined,
          reviewedBy: (evidence.humanReviewBy as string | undefined) ?? undefined,
        },
      };
    } catch (error) {
      return reply.code(503).send({ error: 'Database unavailable' });
    }
  });

  // Explicit run-scoped views prevent a case/proof from another run leaking into a review.
  fastify.get('/runs/:runId/cases', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    if (useMemoryStore()) {
      const run = memoryStore.runs.get(runId);
      if (!run) return reply.code(404).send({ error: 'Run not found' });
      return { data: run.cases, total: run.cases.length, runId, generatedAt: new Date().toISOString() };
    }
    if (!process.env.DATABASE_URL) return reply.code(503).send({ error: 'Database unavailable' });
    const run = await prisma.reconciliationRun.findUnique({ where: { id: runId } });
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    const records = await prisma.case.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } });
    return { data: records, total: records.length, runId, generatedAt: new Date().toISOString() };
  });

  fastify.get('/runs/:runId/cases/:caseId/proof', async (request, reply) => {
    const { runId, caseId } = request.params as { runId: string; caseId: string };
    if (useMemoryStore()) {
      const run = memoryStore.runs.get(runId);
      if (!run || !run.cases.some((item) => item.id === caseId)) return reply.code(404).send({ error: 'Case not found for run' });
      return run.proofs[caseId] ?? reply.code(404).send({ error: 'Proof not found' });
    }
    if (!process.env.DATABASE_URL) return reply.code(503).send({ error: 'Database unavailable' });
    const record = await prisma.case.findFirst({ where: { id: caseId, runId }, include: { agentActions: true, auditEvents: { orderBy: { createdAt: 'asc' } } } });
    if (!record) return reply.code(404).send({ error: 'Case not found for run' });
    return { caseId: record.id, caseType: record.caseType, machineState: record.state, machineReason: record.reason, evidence: record.evidence, agentActions: record.agentActions, auditEvents: record.auditEvents };
  });

  const askHandler = async (request: any, reply: any) => {
    const body = (request.body ?? {}) as { question?: unknown; runId?: unknown };
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question) return reply.code(400).send({ error: 'question is required' });
    let runId = typeof body.runId === 'string' ? body.runId : undefined;
    if (useMemoryStore()) runId = runId ?? memoryStore.activeRunId;
    else if (!runId) runId = (await prisma.reconciliationRun.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true } }))?.id;
    if (!runId) return reply.code(404).send({ error: 'No reconciliation run found' });
    let cases: Array<{ id: string; reason?: string | null; state?: string; amountMinor?: number; caseType?: string; evidenceRequired?: string[]; evidenceMissing?: string[] }> = [];
    let metrics: Record<string, unknown> = {};
    if (useMemoryStore()) {
      const run = memoryStore.runs.get(runId);
      if (!run) return reply.code(404).send({ error: 'Run not found' });
      cases = run.cases; metrics = run.metrics;
    } else {
      if (!process.env.DATABASE_URL) return reply.code(503).send({ error: 'Database unavailable' });
      const run = await prisma.reconciliationRun.findUnique({ where: { id: runId }, include: { cases: true } });
      if (!run) return reply.code(404).send({ error: 'Run not found' });
      metrics = (run.metrics as Record<string, unknown> | null) ?? {};
      cases = run.cases.map((item) => {
        const e = (item.evidence as Record<string, unknown> | null) ?? {};
        return {
          id: item.id, reason: item.reason, state: item.state, caseType: item.caseType,
          amountMinor: Number(e.amountMinor ?? 0),
          evidenceRequired: Array.isArray(e.evidenceMissing) ? e.evidenceMissing as string[] : [],
          evidenceMissing: Array.isArray(e.evidenceMissing) ? e.evidenceMissing as string[] : [],
        };
      });
    }
    const intent = await parseIntent(question);
    const { answer: generatedAnswer, citations, grounded } = executeIntent(intent, runId, metrics as Record<string, number>, cases);
    return { runId, question, answer: generatedAnswer, citations, unavailable: !grounded, groundedIn: grounded ? 'persisted run cases and metrics' : undefined, readOnly: true };
  };
  fastify.post('/ask-anvaya', askHandler);
  fastify.post('/reconciliation/runs/:id/ask', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    request.body = { ...body, runId: (request.params as { id: string }).id };
    return askHandler(request, reply);
  });

  fastify.post('/cases/:id/resolve', async (request, reply) => {
    const params = request.params as { id: string };
    const parsed = HumanResolutionRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid human resolution request',
        details: parsed.error.issues.map((issue) => issue.message).join('; '),
      });
    }

    const existingCase = await prisma.case.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        state: true,
        reason: true,
        evidence: true,
      },
    });

    if (!existingCase) {
      return reply.code(404).send({ error: 'Case not found' });
    }

    const requestedState = parsed.data.overrideState ?? (existingCase.state === 'PENDING' ? 'PENDING' : 'ESCALATED');
    const didOverwriteMachineDecision = requestedState !== existingCase.state;
    const previousEvidence = (existingCase.evidence as Record<string, unknown> | null) ?? {};

    const humanReviewPayload = {
      reason: parsed.data.reason,
      comment: parsed.data.comment,
      reviewedBy: parsed.data.reviewedBy ?? 'human-reviewer',
      sourceEvidence: parsed.data.sourceEvidence ??[],
      candidate: parsed.data.candidate ?? previousEvidence.candidate ?? null,
      validationChecks: parsed.data.validationChecks ?? previousEvidence.validationChecks ?? [],
      machineState: existingCase.state,
      machineReason: existingCase.reason,
      didOverwriteMachineDecision,
      overrideState: requestedState,
      reviewedAt: new Date().toISOString(),
    };

    const [updatedCase, auditEvent] = await prisma.$transaction(async (tx) => {
      const lockedCase = await tx.case.findUnique({
        where: { id: params.id },
        select: { id: true, state: true, reason: true, evidence: true },
      });

      if (!lockedCase) {
        throw new Error('Case not found');
      }

      const updated = await tx.case.update({
        where: { id: params.id },
        data: {
          state: requestedState,
          reason: parsed.data.reason,
          evidence: {
            ...(lockedCase.evidence as Record<string, unknown> | null),
            ...previousEvidence,
            humanReview: humanReviewPayload,
            finalState: requestedState,
            reason: parsed.data.reason,
          },
          updatedAt: new Date(),
        },
      });

      const createdAudit = await tx.auditEvent.create({
        data: {
          caseId: params.id,
          entityType: 'case',
          entityId: params.id,
          eventType: 'HUMAN_RESOLUTION',
          eventSummary: parsed.data.reason,
          actorType: 'HUMAN',
          payload: humanReviewPayload,
        },
      });

      return [updated, createdAudit] as const;
    });

    return {
      caseId: updatedCase.id,
      originalMachineState: existingCase.state,
      originalMachineReason: existingCase.reason,
      humanState: requestedState,
      reason: parsed.data.reason,
      comment: parsed.data.comment,
      reviewedBy: parsed.data.reviewedBy ?? 'human-reviewer',
      didOverwriteMachineDecision,
      auditEventId: auditEvent.id,
    };
  });
}
