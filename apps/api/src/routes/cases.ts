import type { FastifyInstance } from 'fastify';

import { HumanResolutionRequestSchema } from '@anvaya/contracts';

import { prisma } from '../lib/prisma.js';

export async function casesRoutes(fastify: FastifyInstance) {
  fastify.get('/cases/:id/proof', async (request, reply) => {
    const params = request.params as { id: string };
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
