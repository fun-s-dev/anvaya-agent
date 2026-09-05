/**
 * reconciliation.ts - API routes for reconciliation runs.
 *
 * Production path: uses PostgreSQL + canonical records.
 * Memory path: uses memoryStore (for tests and explicit demo mode).
 *
 * IMPORTANT: The production path NEVER uses the calculate() helper below for DB runs.
 * DB runs use orchestrateRun() which loads canonical Transaction/Settlement/BankEntry records.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { reconcileDeterministicFastPath } from '@anvaya/reconciliation';
import { runAgentActionLoop, shouldBypassLlm, type LlmProvider, type AgentCaseContext } from '@anvaya/agent';
import { prisma } from '../lib/prisma.js';
import { demoCsvContent, memoryStore, parseCsv, useMemoryStore, type PersistedRun } from '../lib/demo.js';
import { orchestrateRun, persistRunToDb, getConfiguredLlmProvider } from '../lib/run-orchestrator.js';
import { deriveVarianceIntelligence } from '../lib/variance-intelligence.js';
import { generateScenario, serializeScenarioToCsvViews, type ScenarioMutation } from '@anvaya/generator';

type IdBody = { import_ids?: unknown };
type Row = { id: string; sourceRecordId: string; row: Record<string, string> };

// ---------------------------------------------------------------------------
// Memory-mode calculation helper (used ONLY when ANVAYA_DEMO_STORE=memory).
// NOT used in the DB production path.
// ---------------------------------------------------------------------------
function calculateMemoryMode(rows: Row[], importIds: string[], runId: string, durationMs: number): PersistedRun {
  const merchant = rows.filter((r) => r.row.external_ref).map((r) => ({ id: r.sourceRecordId, externalRef: r.row.external_ref, amountMinor: Number(r.row.amount_minor), transactionDate: r.row.transaction_date }));
  const psp = rows.filter((r) => r.row.psp_transaction_id).map((r) => ({ id: r.row.psp_transaction_id, transactionRef: r.row.transaction_ref, settlementId: r.row.settlement_source_record_id, amountMinor: Number(r.row.component_amount_minor), transactionDate: r.row.settlement_date }));
  const settlements = [...new Map(rows.filter((r) => r.row.settlement_source_record_id).map((r) => [r.row.settlement_source_record_id, { id: r.row.settlement_source_record_id, statedAmountMinor: Number(r.row.stated_amount_minor) }])).values()];
  const components = rows.filter((r) => r.row.component_id).map((r) => ({ settlementId: r.row.settlement_source_record_id, amountMinor: Number(r.row.component_amount_minor), financialEffectMinor: Number(r.row.financial_effect_minor) }));
  const banks = rows.filter((r) => r.row.entry_ref).map((r) => ({ id: r.sourceRecordId, amountMinor: Number(r.row.amount_minor), postedAt: r.row.posted_at, narration: r.row.narration }));

  const result = reconcileDeterministicFastPath({ settlements, settlementComponents: components, merchantTransactions: merchant, pspTransactions: psp, bankEntries: banks });

  const unmatchedBankIds = new Set([...result.pendingBankEntryIds, ...result.overdueBankEntryIds]);
  const matchedBankIds = new Set(result.aggregateMatches.map((m) => m.bankEntryId).filter(Boolean));

  const now = new Date().toISOString();
  
  let amountMismatchVariance = 0;
  const pspMap = new Map(psp.map(p => [p.id, p]));
  const transactionCases = [];
  for (const match of result.exactReferenceMatches) {
    const pspTx = pspMap.get(match.pspTransactionId ?? '');
    if (pspTx && pspTx.amountMinor !== match.amountMinor) {
      const variance = Math.abs(pspTx.amountMinor - match.amountMinor);
      amountMismatchVariance += variance;
      transactionCases.push({
        id: `case-${runId}-tx-${match.transactionId}`,
        caseType: 'TRANSACTION_SETTLEMENT' as const,
        priority: variance > 200000 ? 'HIGH' : 'MEDIUM',
        amountMinor: variance,
        rupeeImpactMinor: variance,
        state: 'ESCALATED',
        reason: 'AMOUNT_MISMATCH',
        evidenceFound: [match.transactionId ?? '', pspTx.id],
        evidenceRequired: ['amount_correction'],
        deterministicPriority: ['source lineage'],
        createdAt: now,
      });
    }
  }

  // Cases from unmatched bank entries.
  const exceptions = rows.filter((r) => r.row.entry_ref && !matchedBankIds.has(r.sourceRecordId)).slice(0, 50);
  const unmatchedBankCashValueMinor = banks.reduce((acc, b) => acc + b.amountMinor, 0);
  const unmatchedPspSettlementValueMinor = settlements.reduce((acc, s) => acc + (s.statedAmountMinor ?? 0), 0);
  const exceedBankCredit = unmatchedBankCashValueMinor > unmatchedPspSettlementValueMinor;

  const bankCases = exceptions.map((r, i) => ({
    id: `case-${runId}-bank-${i + 1}`,
    caseType: 'SETTLEMENT_BANK' as const,
    priority: Number(r.row.amount_minor ?? 0) > 200000 ? 'HIGH' : 'MEDIUM',
    amountMinor: Number(r.row.amount_minor ?? r.row.stated_amount_minor ?? 0),
    rupeeImpactMinor: Number(r.row.amount_minor ?? r.row.stated_amount_minor ?? 0),
    state: (result.overdueBankEntryIds.includes(r.sourceRecordId) ? 'ESCALATED' : 'PENDING') as string,
    reason: (result.overdueBankEntryIds.includes(r.sourceRecordId) ? 'TIMING_DELAY' : exceedBankCredit ? 'UNATTRIBUTED_BANK_ENTRY' : 'MISSING_BANK_CREDIT') as string,
    evidenceFound: [r.sourceRecordId],
    evidenceRequired: ['bank credit evidence', 'settlement trace'],
    deterministicPriority: ['source lineage'],
    createdAt: now,
  }));

  const cases = [...transactionCases, ...bankCases];

  const processedRecordCount = merchant.length + settlements.length + banks.length;
  const allMatches = [...result.exactReferenceMatches, ...result.normalizedReferenceMatches, ...result.amountDateMatches];
  const matchedMerchantCount = new Set(allMatches.map((m) => m.transactionId).filter(Boolean)).size;
  const matchedSettlementCount = new Set(result.aggregateMatches.map((m) => m.settlementId).filter(Boolean)).size;
  const throughputPerHour = durationMs > 0 ? Math.round((processedRecordCount / durationMs) * 1000 * 3600) : processedRecordCount;

  const grossSourceValueMinor = merchant.reduce((acc, m) => acc + m.amountMinor, 0);
  const pspSettlementValueMinor = settlements.reduce((acc, s) => acc + (s.statedAmountMinor ?? 0), 0);
  const bankCashValueMinor = banks.reduce((acc, b) => acc + b.amountMinor, 0);

  const verifiedValueMinor = cases.filter((c) => c.state === 'VERIFIED').reduce((s, c) => s + c.amountMinor, 0);
  const pendingValueMinor = cases.filter((c) => c.state === 'PENDING').reduce((s, c) => s + c.amountMinor, 0);
  const unresolvedValueMinor = Math.max(0, result.unresolvedAmountMinor) + amountMismatchVariance;

  const metrics = {
    grossSourceValueMinor,
    pspSettlementValueMinor,
    bankCashValueMinor,
    batchRecordCount: processedRecordCount,
    matchRateTransactionSettlement: merchant.length > 0 ? matchedMerchantCount / merchant.length : 0,
    matchRateSettlementBank: settlements.length > 0 ? matchedSettlementCount / settlements.length : 0,
    verifiedValueMinor,
    pendingValueMinor,
    unresolvedValueMinor,
    humanReviewRate: processedRecordCount > 0 ? cases.length / processedRecordCount : 0,
    throughputPerHour,
    processingDurationMs: durationMs,
    caseCount: cases.length,
    llmCallsUsed: 0,
    llmCallBudget: Math.min(20, Math.max(5, Math.ceil(0.1 * processedRecordCount))),
    falseResolutionRate: 0,
    explainedVarianceMinor: result.explainedVarianceMinor,
    unexplainedVarianceMinor: result.unresolvedAmountMinor,
    verifiedCases: Math.max(0, banks.length - bankCases.length),
    pendingCases: cases.filter((c) => c.state === 'PENDING').length,
    escalatedCases: cases.filter((c) => c.state === 'ESCALATED').length,
  };

  const proofs = Object.fromEntries(cases.map((c) => [c.id, {
    caseId: c.id,
    caseType: c.caseType,
    machineState: c.state,
    machineReason: c.reason,
    sourceEvidence: c.evidenceFound,
    evidenceFound: c.evidenceFound,
    evidenceMissing: c.evidenceRequired,
    candidate: null,
    validationChecks: [{ check: 'provenance', message: 'Source lineage is persisted for deterministic review.', severity: 'warning' }],
    finalState: c.state,
    reason: c.reason,
    actionTrace: [] as Array<{ actionName: string; status: string; createdAt: string }>,
    auditTrail: [{ eventType: 'VALIDATION', eventSummary: 'Deterministic validation completed.', createdAt: now }],
    humanReview: { required: c.state === 'ESCALATED' },
  }]));

  return { runId, status: 'complete', asOf: now, importIds, metrics, cases, proofs };
}

// ---------------------------------------------------------------------------
// Source role validation
// ---------------------------------------------------------------------------
function validateImportRoles(imports: Array<{ id: string; sourceType: string; provider: string }>): { valid: boolean; error?: string } {
  const requiredRoles = new Set(['merchant', 'psp', 'bank']);
  const seenRoles = new Map<string, string>();

  for (const imp of imports) {
    const role = imp.sourceType;
    if (seenRoles.has(role)) {
      return { valid: false, error: `Duplicate source role '${role}'. Each role (merchant, psp, bank) must be provided exactly once.` };
    }
    seenRoles.set(role, imp.id);
  }

  for (const required of requiredRoles) {
    if (!seenRoles.has(required)) {
      return { valid: false, error: `Missing required source role '${required}'. All three roles (merchant, psp, bank) must be present.` };
    }
  }

  const providers = [...new Set(imports.map((i) => i.provider))];
  if (providers.length !== 1) {
    return { valid: false, error: `All imports must have the same provider. Found: ${providers.join(', ')}.` };
  }

  return { valid: true };
}

export async function reconciliationRoutes(fastify: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // POST /demo/generate - generates demo imports dynamically based on a scenario.
  // ---------------------------------------------------------------------------
  fastify.post('/demo/generate', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as { scenario?: string };
      const scenarioName = body.scenario ?? 'Clean Reconciliation';
      const runScopeId = randomUUID().slice(0, 8);
      const scope = `demo-${scenarioName.replace(/ /g, '-').toLowerCase()}-${runScopeId}-`;

      let mutations: ScenarioMutation[] = [];
      let seed = 42;
      if (scenarioName === 'Amount Mismatch') mutations = ['wrong_amount'];
      else if (scenarioName === 'Mixed Investigation') mutations = ['wrong_amount', 'missing_settlement', 'ambiguous_reference', 'unattributed_bank_entry'];

      const generated = generateScenario({ seed, size: 100, profile: 'clean', mutations });
      const csvViews = serializeScenarioToCsvViews(generated);

      const ids: string[] = [];
      for (const sourceType of ['merchant', 'psp', 'bank'] as const) {
        const content = sourceType === 'merchant' ? csvViews.merchantTransactions : sourceType === 'psp' ? csvViews.settlementRecords : csvViews.bankStatement;
        const rows = parseCsv(content);
        const id = `imp-${randomUUID()}`;
        const filename = sourceType === 'merchant' ? 'merchant_transactions.csv' : sourceType === 'psp' ? 'settlement_records.csv' : 'bank_statement.csv';
        const checksum = `demo-seed-${seed}-${scenarioName.replace(/ /g, '-')}-${sourceType}-v3`;

        if (useMemoryStore()) {
          const record = {
            id, provider: 'razorpay', sourceType, filename, checksum,
            fileSizeBytes: Buffer.byteLength(content), status: 'validated' as const,
            createdAt: new Date().toISOString(), importedAt: new Date().toISOString(),
            rawRecords: rows.map((row, i) => ({
              id: `${id}-raw-${i + 1}`,
              sourceRecordId: scope + String(row.source_record_id || row.psp_transaction_id || row.component_id || row.entry_ref || `${id}-${i + 1}`),
              row,
            })),
          };
          memoryStore.imports.set(id, record);
        } else {
          // Check idempotency by checksum.
          const existing = await prisma.import.findFirst({
            where: { provider: 'razorpay', sourceType, checksum },
          });
          if (existing) {
            ids.push(existing.id);
            continue;
          }

          // Create import + rawRecords.
          const created = await prisma.import.create({
            data: {
              id,
              provider: 'razorpay',
              sourceType,
              filename,
              checksum,
              fileSizeBytes: Buffer.byteLength(content),
              status: 'received',
              sourceRecordCount: rows.length,
              rawRecords: {
                create: rows.map((row, i) => ({
                  provider: 'razorpay',
                  sourceType,
                  sourceRecordId: scope + String(row.source_record_id || row.psp_transaction_id || row.component_id || row.entry_ref || `${id}-${i + 1}`),
                  rowJson: row,
                })),
              },
            },
          });

          // Materialize canonical records (same as real import path).
          const rawRecords = await prisma.rawRecord.findMany({ where: { importId: created.id } });
          if (sourceType === 'merchant') {
            await prisma.transaction.createMany({
              data: rawRecords.map((r) => {
                const row = r.rowJson as Record<string, unknown>;
                return {
                  importId: created.id,
                  rawRecordId: r.id,
                  provider: 'razorpay',
                  sourceType: 'merchant',
                  sourceRecordId: r.sourceRecordId,
                  externalRef: String(row.external_ref ?? ''),
                  amountMinor: Number(row.amount_minor ?? 0),
                  currency: String(row.currency ?? 'INR'),
                  transactionDate: row.transaction_date ? new Date(String(row.transaction_date)) : null,
                  status: String(row.status ?? ''),
                };
              }),
              skipDuplicates: true,
            });
          } else if (sourceType === 'bank') {
            await prisma.bankEntry.createMany({
              data: rawRecords.map((r) => {
                const row = r.rowJson as Record<string, unknown>;
                return {
                  importId: created.id,
                  rawRecordId: r.id,
                  provider: 'razorpay',
                  sourceType: 'bank',
                  sourceRecordId: r.sourceRecordId,
                  entryRef: String(row.entry_ref ?? ''),
                  amountMinor: Number(row.amount_minor ?? 0),
                  currency: String(row.currency ?? 'INR'),
                  postedAt: row.posted_at ? new Date(String(row.posted_at)) : null,
                  narration: String(row.narration ?? ''),
                  direction: String(row.direction ?? ''),
                };
              }),
              skipDuplicates: true,
            });
          } else {
            // PSP: create settlements and components.
            const settlementIds = new Map<string, string>();
            for (const r of rawRecords) {
              const row = r.rowJson as Record<string, unknown>;
              const key = row.settlement_source_record_id ? scope + String(row.settlement_source_record_id) : (r.sourceRecordId ?? '');
              let settlementId = settlementIds.get(key);
              if (!settlementId) {
                const s = await prisma.settlement.create({
                  data: {
                    importId: created.id,
                    rawRecordId: r.id,
                    provider: 'razorpay',
                    sourceType: 'psp',
                    sourceRecordId: key,
                    externalSettlementId: String(row.external_settlement_id ?? ''),
                    statedAmountMinor: Number(row.stated_amount_minor ?? 0),
                    currency: String(row.currency ?? 'INR'),
                    settlementDate: row.settlement_date ? new Date(String(row.settlement_date)) : null,
                  },
                });
                settlementId = s.id;
                settlementIds.set(key, settlementId);
              }
              await prisma.settlementComponent.create({
                data: {
                  settlementId,
                  provider: 'razorpay',
                  sourceType: 'psp',
                  sourceRecordId: row.transaction_ref || row.psp_transaction_id || row.component_id ? scope + String(row.transaction_ref ?? row.psp_transaction_id ?? row.component_id) : r.sourceRecordId,
                  componentType: String(row.component_type ?? ''),
                  componentKind: String(row.component_type ?? ''),
                  amountMinor: Number(row.component_amount_minor ?? 0),
                  financialEffectMinor: Number(row.financial_effect_minor ?? 0),
                  currency: String(row.currency ?? 'INR'),
                  metadata: { transactionRef: String(row.transaction_ref ?? '') },
                },
              });
            }
          }

          await prisma.import.update({ where: { id: created.id }, data: { status: 'validated' } });
        }
        ids.push(id);
      }

      return {
        generatedAt: new Date().toISOString(),
        datasetName: `synthetic-demo-${scenarioName.replace(/ /g, '-')}`,
        importIds: ids,
        files: ['merchant_transactions.csv', 'settlement_records.csv', 'bank_statement.csv'],
        retentionDays: 7,
        note: 'Synthetic data only; no production financial records are used in the demo.',
      };
    } catch (e) {
      console.error('Error generating demo scenario:', e);
      return reply.code(500).send({
        error: 'Failed to generate demo scenario.',
        message: 'Could not load the requested scenario. Check the API server logs.'
      });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /reconciliation/runs - core production run endpoint.
  // ---------------------------------------------------------------------------
  const runHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as IdBody | undefined;
    const ids = Array.isArray(body?.import_ids)
      ? body.import_ids.filter((id): id is string => typeof id === 'string')
      : [];

    // Memory store path (tests / explicit demo mode).
    if (useMemoryStore()) {
      const effectiveIds = ids.length > 0
        ? ids
        : Array.from(memoryStore.imports.keys()).slice(-3);

      if (effectiveIds.length !== 3) {
        return reply.code(400).send({ error: 'import_ids must contain exactly 3 imports: merchant, psp, and bank.' });
      }

      const missingIds = effectiveIds.filter((id) => !memoryStore.imports.has(id));
      if (missingIds.length > 0) {
        return reply.code(404).send({ error: 'Import not found', details: missingIds });
      }

      // Validate source roles in memory store.
      const memImports = effectiveIds.map((id) => {
        const imp = memoryStore.imports.get(id)!;
        return { id: imp.id, sourceType: imp.sourceType, provider: imp.provider };
      });
      const roleCheck = validateImportRoles(memImports);
      if (!roleCheck.valid) {
        return reply.code(400).send({ error: roleCheck.error });
      }

      const runId = `run-${randomUUID()}`;
      const started = Date.now();
      const allRows = effectiveIds.flatMap((id) => memoryStore.imports.get(id)!.rawRecords);
      const run = calculateMemoryMode(allRows, effectiveIds, runId, Date.now() - started);

      // Run agent for ambiguous cases in memory mode.
      let llmCallsUsed = 0;
      let runLlmCallCount = 0;
      for (const item of run.cases) {
        const agentContext: AgentCaseContext = {
          caseId: item.id,
          caseType: 'SETTLEMENT_BANK',
          state: item.state as 'PENDING' | 'ESCALATED',
          reason: item.reason as 'TIMING_DELAY' | 'MISSING_BANK_CREDIT' | 'AMBIGUOUS_REFERENCE',
          actionCount: 0,
          llmCallCount: 0,
          runLlmCallCount,
          evidence: { sourceRecordId: item.evidenceFound[0], amountMinor: item.amountMinor },
          availableActions: ['CHECK_TIMING', 'MATCH_AGGREGATE', 'INTERPRET_EVIDENCE', 'ESCALATE'],
          batchRecordCount: run.metrics.batchRecordCount,
        };

        // Only invoke agent for genuinely ambiguous cases (not clean/resolved).
        if (!shouldBypassLlm(agentContext)) {
          // NEVER pass null - use Gemini when configured, otherwise the deterministic mock.
          const trace = await runAgentActionLoop(agentContext, getConfiguredLlmProvider());
          if (trace.llmResult?.metadata) {
            llmCallsUsed += 1;
            runLlmCallCount += 1;
          }
          if (trace.nextAction) {
            (run.proofs[item.id]!.actionTrace as Array<{ actionName: string; status: string; createdAt: string }>).push({
              actionName: trace.nextAction.next_action,
              status: trace.finalState,
              createdAt: new Date().toISOString(),
            });
          }
        }
      }

      run.metrics.llmCallsUsed = llmCallsUsed;
      run.metrics.llmCallBudget = Math.min(20, Math.max(5, Math.ceil(0.1 * run.metrics.batchRecordCount)));
      run.metrics.processingDurationMs = Date.now() - started;
      const elapsedMs = Math.max(1, Date.now() - started);
      run.metrics.throughputPerHour = Math.round((run.metrics.batchRecordCount / elapsedMs) * 1000 * 3600);

      const checksum = memoryStore.imports.get(effectiveIds.find(id => memoryStore.imports.get(id)?.sourceType === 'merchant')!)?.checksum ?? '';
      const match = checksum.match(/demo-seed-\d+-(.+)-merchant/);
      const datasetName = match ? match[1].replace(/-/g, ' ') : 'Manual Dataset';
      (run.metrics as Record<string, unknown>).datasetName = datasetName;

      memoryStore.runs.set(run.runId, run);
      memoryStore.activeRunId = run.runId;
      return reply.code(200).send(run);
    }

    // ---------------------------------------------------------------------------
    // PostgreSQL production path.
    // ---------------------------------------------------------------------------
    if (ids.length !== 3) {
      return reply.code(400).send({ error: 'import_ids must contain exactly 3 imports: merchant, psp, and bank.' });
    }

    let runId: string | undefined;
    const startedAt = new Date();

    try {
      // Load and validate imports.
      const imports = await prisma.import.findMany({ where: { id: { in: ids } } });

      if (imports.length !== ids.length) {
        const foundIds = new Set(imports.map((i) => i.id));
        const missing = ids.filter((id) => !foundIds.has(id));
        return reply.code(404).send({ error: 'Import not found', details: missing });
      }

      const roleCheck = validateImportRoles(imports.map((i) => ({ id: i.id, sourceType: i.sourceType, provider: i.provider })));
      if (!roleCheck.valid) {
        return reply.code(400).send({ error: roleCheck.error });
      }

      const provider = imports[0]!.provider;
      const merchantImport = imports.find((i) => i.sourceType === 'merchant')!;
      const pspImport = imports.find((i) => i.sourceType === 'psp')!;
      const bankImport = imports.find((i) => i.sourceType === 'bank')!;

      // Create run record with RUNNING status.
      runId = `run-${randomUUID()}`;
      await prisma.reconciliationRun.create({
        data: {
          id: runId,
          status: 'running',
          provider,
          importIds: ids,
          startedAt,
        },
      });

      // Execute the full pipeline.
      const { cases, metrics, durationMs } = await orchestrateRun(
        runId,
        merchantImport.id,
        pspImport.id,
        bankImport.id,
        provider,
        ids,
      );

      const checksum = merchantImport.checksum;
      const match = checksum.match(/demo-seed-\d+-(.+)-merchant/);
      const datasetName = match ? match[1].replace(/-/g, ' ') : 'Manual Dataset';
      (metrics as Record<string, unknown>).datasetName = datasetName;

      const completedAt = new Date();

      // Persist cases, evidence, validation, and agent trace atomically.
      await persistRunToDb(runId, provider, ids, cases, metrics, startedAt, completedAt, durationMs);

      // Build proof map for the response.
      const proofs: Record<string, unknown> = {};
      for (const c of cases) {
        proofs[c.id] = {
          caseId: c.id,
          caseType: c.caseType,
          machineState: c.state,
          machineReason: c.reason,
          sourceEvidence: c.evidenceFound,
          evidenceFound: c.evidenceFound,
          evidenceMissing: c.evidenceRequired,
          candidate: null,
          validationChecks: c.validationChecks,
          finalState: c.state,
          reason: c.reason,
          actionTrace: c.agentTrace.map((step) => ({
            actionName: step.actionName,
            status: step.status,
            createdAt: step.createdAt,
          })),
          auditTrail: [{
            eventType: 'VALIDATION',
            eventSummary: `Deterministic validation: ${c.validationStatus}`,
            createdAt: completedAt.toISOString(),
          }],
          humanReview: { required: c.humanReviewRequired },
        };
      }

      return reply.code(201).send({
        runId,
        runNumber: (await prisma.reconciliationRun.findUnique({ where: { id: runId } }))?.runNumber,
        status: 'complete',
        asOf: completedAt.toISOString(),
        importIds: ids,
        metrics,
        cases: cases.map((c) => ({
          id: c.id,
          caseType: c.caseType,
          state: c.state,
          reason: c.reason,
          priority: c.priority,
          amountMinor: c.amountMinor,
          rupeeImpactMinor: c.amountMinor,
          evidenceFound: c.evidenceFound,
          evidenceRequired: c.evidenceRequired,
          deterministicPriority: c.deterministicPriority,
          createdAt: c.createdAt,
        })),
        proofs,
      });
    } catch (error) {
      // Mark run as failed if we created one.
      if (runId) {
        try {
          await prisma.reconciliationRun.update({
            where: { id: runId },
            data: {
              status: 'failed',
              completedAt: new Date(),
              durationMs: Date.now() - startedAt.getTime(),
            },
          });
        } catch {
          // Best-effort failure mark - don't swallow the original error.
        }
      }
      return reply.code(503).send({
        error: 'Reconciliation run failed',
        details: error instanceof Error ? error.message : 'An unexpected error occurred during run execution.',
      });
    }
  };

  fastify.post('/reconciliation/runs', runHandler);
  fastify.post('/runs', runHandler);

  // ---------------------------------------------------------------------------
  // GET /reconciliation/runs/:id
  // ---------------------------------------------------------------------------
  fastify.get('/reconciliation/runs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (useMemoryStore()) {
      const run = memoryStore.runs.get(id);
      return run ? { ...run, variance: deriveVarianceIntelligence(run.cases, run.metrics) } : reply.code(404).send({ error: 'Run not found' });
    }
    const run = await prisma.reconciliationRun.findUnique({
      where: { id },
      include: { cases: { orderBy: { createdAt: 'asc' } } },
    });

    if (!run) return reply.code(404).send({ error: 'Run not found' });
    return {
      runId: run.id,
      runNumber: run.runNumber,
      status: run.status,
      provider: run.provider,
      importIds: run.importIds,
      metrics: run.metrics,
      durationMs: run.durationMs,
      startedAt: run.startedAt?.toISOString(),
      asOf: (run.completedAt ?? run.createdAt).toISOString(),
      caseCount: run.cases.length,
      cases: run.cases,
      variance: deriveVarianceIntelligence(run.cases.map((item) => { const e = (item.evidence as Record<string, unknown> | null) ?? {}; return { id: item.id, caseType: item.caseType, reason: item.reason, state: item.state, amountMinor: Number(e.amountMinor ?? 0), evidenceFound: Array.isArray(e.evidenceFound) ? e.evidenceFound as string[] : [], evidenceRequired: Array.isArray(e.evidenceMissing) ? e.evidenceMissing as string[] : [] }; }), (run.metrics as Record<string, unknown> | null) ?? {}),
    };
  });


  // NOTE: GET /reconciliation/runs (list all) is intentionally NOT registered.
  // Without authentication, a global run listing would expose all users' historical
  // reconciliation data. Individual runs are accessible by ID only (session-scoped).


  const variance = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    if (useMemoryStore()) {
      const run = memoryStore.runs.get(id);
      return run ? deriveVarianceIntelligence(run.cases, run.metrics) : reply.code(404).send({ error: 'Run not found' });
    }
    if (!process.env.DATABASE_URL) return reply.code(503).send({ error: 'Database unavailable' });
    const run = await prisma.reconciliationRun.findUnique({ where: { id }, include: { cases: true } });
    return run ? deriveVarianceIntelligence(run.cases.map((item) => { const e = (item.evidence as Record<string, unknown> | null) ?? {}; return { id: item.id, caseType: item.caseType, reason: item.reason, state: item.state, priority: item.priority, amountMinor: Number(e.amountMinor ?? 0), evidenceFound: Array.isArray(e.evidenceFound) ? e.evidenceFound as string[] : [], evidenceRequired: Array.isArray(e.evidenceMissing) ? e.evidenceMissing as string[] : [] }; }), (run.metrics as Record<string, unknown> | null) ?? {}) : reply.code(404).send({ error: 'Run not found' });
  };
  fastify.get('/reconciliation/runs/:id/variance', variance);
  fastify.get('/runs/:id/variance', variance);

  fastify.get('/runs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (useMemoryStore()) {
      const run = memoryStore.runs.get(id);
      return run ? run : reply.code(404).send({ error: 'Run not found' });
    }
    const run = await prisma.reconciliationRun.findUnique({ where: { id }, include: { cases: true } });
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    return {
      runId: run.id,
      runNumber: run.runNumber,
      status: run.status,
      provider: run.provider,
      importIds: run.importIds,
      metrics: run.metrics,
      durationMs: run.durationMs,
      asOf: (run.completedAt ?? run.createdAt).toISOString(),
      cases: run.cases,
      variance: deriveVarianceIntelligence(run.cases.map((item) => { const e = (item.evidence as Record<string, unknown> | null) ?? {}; return { id: item.id, caseType: item.caseType, reason: item.reason, state: item.state, amountMinor: Number(e.amountMinor ?? 0), evidenceFound: Array.isArray(e.evidenceFound) ? e.evidenceFound as string[] : [], evidenceRequired: Array.isArray(e.evidenceMissing) ? e.evidenceMissing as string[] : [] }; }), (run.metrics as Record<string, unknown> | null) ?? {}),
    };
  });

  // ---------------------------------------------------------------------------
  // GET /metrics - returns metrics from the most recent run.
  // ---------------------------------------------------------------------------
  fastify.get('/metrics', async (_request, reply) => {
    if (useMemoryStore()) {
      const run = memoryStore.activeRunId ? memoryStore.runs.get(memoryStore.activeRunId) : undefined;
      return run ? { runId: run.runId, metrics: run.metrics } : reply.code(404).send({ error: 'No reconciliation run found' });
    }
    const run = await prisma.reconciliationRun.findFirst({ orderBy: { createdAt: 'desc' } });
    return run ? { runId: run.id, metrics: run.metrics } : reply.code(404).send({ error: 'No reconciliation run found' });
  });
}
