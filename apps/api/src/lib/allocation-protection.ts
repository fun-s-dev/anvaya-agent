import { prisma } from './prisma.js';

export type AllocationWriteInput = {
  settlementId: string;
  bankEntryId: string;
  amountMinor: number;
  availableMinor: number;
  currency?: string;
};

export async function reserveAllocationWrite(input: AllocationWriteInput) {
  return prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<Array<{ settlementId: string; bankEntryId: string; amountMinor: number }>>`
      SELECT "settlementId", "bankEntryId", "amountMinor"
      FROM "SettlementBankAllocation"
      WHERE "settlementId" = ${input.settlementId} OR "bankEntryId" = ${input.bankEntryId}
      FOR UPDATE
    `;

    const samePair = lockedRows.some(
      (row) => row.settlementId === input.settlementId && row.bankEntryId === input.bankEntryId,
    );
    if (samePair) {
      throw new Error('Duplicate claim or incompatible allocation detected.');
    }

    const totalAllocated = lockedRows.reduce((sum, row) => sum + row.amountMinor, 0) + input.amountMinor;
    if (totalAllocated > input.availableMinor) {
      throw new Error('Allocation exceeds source availability.');
    }

    return tx.settlementBankAllocation.create({
      data: {
        settlementId: input.settlementId,
        bankEntryId: input.bankEntryId,
        amountMinor: input.amountMinor,
        currency: input.currency ?? 'INR',
        allocationType: 'deterministic',
        matchMethod: 'deterministic_validation',
        isVerified: false,
      },
    });
  });
}
