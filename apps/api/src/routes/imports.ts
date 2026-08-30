import type { FastifyInstance } from 'fastify';
import { ImportRegistrationRequestSchema } from '@anvaya/contracts';

import { prisma } from '../lib/prisma.js';

export async function importsRoutes(fastify: FastifyInstance) {
  fastify.post('/imports', async (request, reply) => {
    const parsed = ImportRegistrationRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid import metadata',
        details: parsed.error.issues.map((issue) => issue.message).join('; '),
      });
    }

    const payload = parsed.data;
    const importRecord = await prisma.import.create({
      data: {
        provider: payload.provider,
        sourceType: payload.sourceType,
        filename: payload.filename,
        checksum: payload.checksum,
        fileSizeBytes: payload.fileSizeBytes,
        status: 'received',
        sourceRecordCount: payload.sourceRecordCount ?? 0,
        createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
        importedAt: payload.importedAt ? new Date(payload.importedAt) : new Date(),
      },
    });

    return reply.code(201).send({
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
    });
  });

  fastify.get('/imports/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const importRecord = await prisma.import.findUnique({
      where: { id: params.id },
      include: {
        rawRecords: true,
      },
    });

    if (!importRecord) {
      return reply.code(404).send({ error: 'Import not found' });
    }

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
