/**
 * imports.ts - API routes for CSV import ingestion.
 *
 * Security rules:
 * - Raw CSV content is NEVER logged.
 * - Raw uploaded documents are NOT exposed through GET endpoints.
 * - Checksums are computed server-side for idempotency.
 *
 * Idempotency:
 * - If an import with the same (provider, sourceType, checksum) already exists,
 *   the existing import is returned (HTTP 200) rather than creating a duplicate.
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ImportRegistrationRequestSchema } from '@anvaya/contracts';

import { memoryStore, parseCsv, useMemoryStore, validateCsvUpload, validateRequiredColumns } from '../lib/demo.js';
import { prisma } from '../lib/prisma.js';

function sourceIdForRow(row: Record<string, string>, sourceType: string, index: number): string {
  if (sourceType === 'psp') return row.component_id || row.psp_transaction_id || row.source_record_id || `${index + 1}`;
  return row.source_record_id || row.transaction_id || row.bank_entry_id || row.entry_ref || `${index + 1}`;
}

function scopedSourceId(importId: string, sourceId: string, shouldScope: boolean): string {
  return shouldScope ? `${importId}:${sourceId}` : sourceId;
}

export async function importsRoutes(fastify: FastifyInstance) {
  fastify.post('/imports', async (request, reply) => {
    const uploaded = request.body as Record<string, unknown>;

    // Validate file-level constraints (extension, size, MIME type, basic CSV signature).
    const uploadValidation = validateCsvUpload({
      filename: typeof uploaded.filename === 'string' ? uploaded.filename : '',
      mimeType: typeof uploaded.mimeType === 'string' ? uploaded.mimeType : undefined,
      sizeBytes: typeof uploaded.fileSizeBytes === 'number' ? uploaded.fileSizeBytes : Number(uploaded.fileSizeBytes ?? 0),
      content: typeof uploaded.content === 'string' ? uploaded.content : undefined,
    });

    if (!uploadValidation.valid) {
      return reply.code(400).send({ error: 'Invalid upload', details: uploadValidation.reason });
    }

    // Validate the import registration metadata schema.
    const parsed = ImportRegistrationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid import metadata',
        details: parsed.error.issues.map((issue) => issue.message).join('; '),
      });
    }

    const payload = parsed.data;
    // NOTE: content is consumed server-side only. It is never stored as-is or logged.
    const content = typeof uploaded.content === 'string' ? uploaded.content : '';

    // ---------------------------------------------------------------------------
    // Memory store path (tests / explicit demo mode).
    // ---------------------------------------------------------------------------
    if (useMemoryStore()) {
      let rows: Record<string, string>[];
      try {
        rows = parseCsv(content);
      } catch (error) {
        return reply.code(400).send({ error: 'Malformed CSV', details: error instanceof Error ? error.message : 'Unable to parse CSV.' });
      }

      const columnError = validateRequiredColumns(rows, payload.sourceType);
      if (columnError) return reply.code(400).send({ error: 'Invalid CSV schema', details: columnError });

      // Idempotency check in memory store.
      const existingEntry = [...memoryStore.imports.values()].find(
        (imp) => imp.provider === payload.provider && imp.sourceType === payload.sourceType && imp.checksum === payload.checksum,
      );
      if (existingEntry) {
        return reply.code(200).send({
          id: existingEntry.id,
          provider: existingEntry.provider,
          sourceType: existingEntry.sourceType,
          filename: existingEntry.filename,
          checksum: existingEntry.checksum,
          fileSizeBytes: existingEntry.fileSizeBytes,
          status: existingEntry.status,
          createdAt: existingEntry.createdAt,
          importedAt: existingEntry.importedAt,
          sourceRecordCount: existingEntry.rawRecords.length,
          acceptedCount: existingEntry.rawRecords.length,
          idempotent: true,
        });
      }

      const id = `imp-${randomUUID()}`;
      const record = {
        id, provider: payload.provider, sourceType: payload.sourceType, filename: payload.filename,
        checksum: payload.checksum, fileSizeBytes: payload.fileSizeBytes ?? 0, status: 'validated' as const,
        createdAt: new Date().toISOString(), importedAt: new Date().toISOString(),
        rawRecords: rows.map((row, index) => ({
          id: `${id}-raw-${index + 1}`,
          sourceRecordId: row.source_record_id || row.transaction_id || row.bank_entry_id || row.entry_ref || `${index + 1}`,
          row,
        })),
      };
      memoryStore.imports.set(id, record);
      return reply.code(201).send({
        id, provider: record.provider, sourceType: record.sourceType, filename: record.filename,
        checksum: record.checksum, fileSizeBytes: record.fileSizeBytes, status: record.status,
        createdAt: record.createdAt, importedAt: record.importedAt,
        sourceRecordCount: record.rawRecords.length, acceptedCount: record.rawRecords.length,
      });
    }

    // ---------------------------------------------------------------------------
    // PostgreSQL production path.
    // ---------------------------------------------------------------------------
    if (!process.env.DATABASE_URL) {
      return reply.code(503).send({ error: 'Database unavailable', details: 'DATABASE_URL is required for production persistence.' });
    }

    // Parse and validate CSV content server-side (browser-parsed rows are NOT trusted).
    let persistedRows: Record<string, string>[];
    try {
      persistedRows = parseCsv(content);
    } catch (error) {
      return reply.code(400).send({ error: 'Malformed CSV', details: error instanceof Error ? error.message : 'Unable to parse CSV.' });
    }

    const columnError = validateRequiredColumns(persistedRows, payload.sourceType);
    if (columnError) return reply.code(400).send({ error: 'Invalid CSV schema', details: columnError });

    // Idempotency: check if import already exists by (provider, sourceType, checksum).
    // The DB has a unique constraint on this triple to prevent duplicate state.
    const existingImport = await prisma.import.findFirst({
      where: {
        provider: payload.provider,
        sourceType: payload.sourceType,
        checksum: payload.checksum,
      },
    });

    if (existingImport) {
      return reply.code(200).send({
        id: existingImport.id,
        provider: existingImport.provider,
        sourceType: existingImport.sourceType,
        filename: existingImport.filename,
        checksum: existingImport.checksum,
        fileSizeBytes: existingImport.fileSizeBytes ?? 0,
        status: existingImport.status,
        createdAt: existingImport.createdAt.toISOString(),
        importedAt: existingImport.importedAt.toISOString(),
        sourceRecordCount: existingImport.sourceRecordCount,
        acceptedCount: existingImport.sourceRecordCount,
        idempotent: true,
      });
    }

    const importId = `imp-${randomUUID()}`;
    const originalSourceIds = persistedRows.map((row, index) => sourceIdForRow(row, payload.sourceType, index));
    const existingRaw = await prisma.rawRecord.findMany({
      where: {
        provider: payload.provider,
        sourceType: payload.sourceType,
        sourceRecordId: { in: originalSourceIds },
      },
      select: { sourceRecordId: true },
    });
    const existingCanonical = payload.sourceType === 'psp'
      ? await prisma.settlement.findMany({
        where: {
          provider: payload.provider,
          sourceType: payload.sourceType,
          sourceRecordId: { in: persistedRows.map((row) => String(row.settlement_source_record_id ?? '')) },
        },
        select: { sourceRecordId: true },
      })
      : [];
    const collidingIds = new Set([
      ...existingRaw.map((record) => record.sourceRecordId),
      ...existingCanonical.map((record) => record.sourceRecordId),
    ]);
    const shouldScope = collidingIds.size > 0;

    // Create the import record and raw records.
    const importRecord = await prisma.import.create({
      data: {
        id: importId,
        provider: payload.provider,
        sourceType: payload.sourceType,
        filename: payload.filename,
        checksum: payload.checksum,
        fileSizeBytes: payload.fileSizeBytes,
        status: 'received',
        sourceRecordCount: persistedRows.length,
        createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
        importedAt: payload.importedAt ? new Date(payload.importedAt) : new Date(),
        rawRecords: {
          create: persistedRows.map((row, index) => ({
            provider: payload.provider,
            sourceType: payload.sourceType,
            // Preserve the original source ID in rowJson; scope only the internal
            // identity when this provider/source namespace already contains it.
            sourceRecordId: scopedSourceId(importId, sourceIdForRow(row, payload.sourceType, index), shouldScope),
            rowJson: row,
          })),
        },
      },
    });

    // Materialize canonical entity tables from the raw records.
    const raw = await prisma.rawRecord.findMany({ where: { importId: importRecord.id } });

    if (payload.sourceType === 'merchant') {
      await prisma.transaction.createMany({
        data: raw.map((record) => {
          const row = record.rowJson as Record<string, unknown>;
          return {
            importId: importRecord.id,
            rawRecordId: record.id,
            provider: payload.provider,
            sourceType: payload.sourceType,
            sourceRecordId: record.sourceRecordId,
            externalRef: String(row.external_ref ?? ''),
            amountMinor: Number(row.amount_minor ?? 0),
            currency: String(row.currency ?? 'INR'),
            transactionDate: row.transaction_date ? new Date(String(row.transaction_date)) : null,
            status: String(row.status ?? ''),
          };
        }),
        skipDuplicates: true,
      });

    } else if (payload.sourceType === 'bank') {
      await prisma.bankEntry.createMany({
        data: raw.map((record) => {
          const row = record.rowJson as Record<string, unknown>;
          return {
            importId: importRecord.id,
            rawRecordId: record.id,
            provider: payload.provider,
            sourceType: payload.sourceType,
            sourceRecordId: record.sourceRecordId,
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
      // PSP: Create settlements (one per unique settlement_source_record_id) and components.
      // Each CSV row is a component; multiple rows share the same settlement.
      const settlementIds = new Map<string, string>();

      for (const record of raw) {
        const row = record.rowJson as Record<string, unknown>;
        const settlementKey = scopedSourceId(importId, String(row.settlement_source_record_id ?? record.sourceRecordId), shouldScope);

        let settlementId = settlementIds.get(settlementKey);
        if (!settlementId) {
          const settlement = await prisma.settlement.create({
            data: {
              importId: importRecord.id,
              rawRecordId: record.id,
              provider: payload.provider,
              sourceType: payload.sourceType,
              sourceRecordId: settlementKey,
              externalSettlementId: String(row.external_settlement_id ?? ''),
              statedAmountMinor: Number(row.stated_amount_minor ?? 0),
              currency: String(row.currency ?? 'INR'),
              settlementDate: row.settlement_date ? new Date(String(row.settlement_date)) : null,
            },
          });
          settlementId = settlement.id;
          settlementIds.set(settlementKey, settlementId);
        }

        // The psp_transaction_id uniquely identifies this component row.
        const componentSourceRecordId = scopedSourceId(importId, String(row.psp_transaction_id ?? row.component_id ?? record.sourceRecordId), shouldScope);

        await prisma.settlementComponent.create({
          data: {
            settlementId,
            provider: payload.provider,
            sourceType: payload.sourceType,
            sourceRecordId: componentSourceRecordId,
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

    // Mark import as validated after successful canonicalization.
    await prisma.import.update({ where: { id: importRecord.id }, data: { status: 'validated' } });

    return reply.code(201).send({
      id: importRecord.id,
      provider: importRecord.provider,
      sourceType: importRecord.sourceType,
      filename: importRecord.filename,
      checksum: importRecord.checksum,
      fileSizeBytes: importRecord.fileSizeBytes ?? 0,
      status: 'validated',
      createdAt: importRecord.createdAt.toISOString(),
      importedAt: importRecord.importedAt.toISOString(),
      sourceRecordCount: importRecord.sourceRecordCount,
      acceptedCount: importRecord.sourceRecordCount,
    });
  });

  // ---------------------------------------------------------------------------
  // GET /imports/:id - returns import metadata (NOT raw CSV content).
  // ---------------------------------------------------------------------------
  fastify.get('/imports/:id', async (request, reply) => {
    const params = request.params as { id: string };

    if (useMemoryStore()) {
      const record = memoryStore.imports.get(params.id);
      if (!record) return reply.code(404).send({ error: 'Import not found' });
      return {
        id: record.id, provider: record.provider, sourceType: record.sourceType,
        filename: record.filename, checksum: record.checksum, fileSizeBytes: record.fileSizeBytes,
        status: record.status, createdAt: record.createdAt, importedAt: record.importedAt,
        sourceRecordCount: record.rawRecords.length, rawRecordCount: record.rawRecords.length,
      };
    }

    const importRecord = await prisma.import.findUnique({
      where: { id: params.id },
      include: { rawRecords: { select: { id: true } } },
    });

    if (!importRecord) return reply.code(404).send({ error: 'Import not found' });

    return {
      id: importRecord.id,
      provider: importRecord.provider,
      sourceType: importRecord.sourceType,
      filename: importRecord.filename,
      checksum: importRecord.checksum,
      fileSizeBytes: importRecord.fileSizeBytes ?? 0,
      status: importRecord.status,
      createdAt: importRecord.createdAt.toISOString(),
      importedAt: importRecord.importedAt.toISOString(),
      sourceRecordCount: importRecord.sourceRecordCount,
      rawRecordCount: importRecord.rawRecords.length,
    };
  });
}
