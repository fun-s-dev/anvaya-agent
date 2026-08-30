-- CreateTable
CREATE TABLE "Import" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "fileSizeBytes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'received',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceRecordCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawRecord" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRecordId" TEXT,
    "fingerprint" TEXT,
    "rowJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rawRecordId" TEXT,
    "provider" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'merchant',
    "sourceRecordId" TEXT,
    "fingerprint" TEXT,
    "externalRef" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "transactionDate" TIMESTAMP(3),
    "status" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rawRecordId" TEXT,
    "provider" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'psp',
    "sourceRecordId" TEXT,
    "fingerprint" TEXT,
    "externalSettlementId" TEXT,
    "statedAmountMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "settlementDate" TIMESTAMP(3),
    "status" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementComponent" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'psp',
    "sourceRecordId" TEXT,
    "componentType" TEXT,
    "componentKind" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "financialEffectMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankEntry" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rawRecordId" TEXT,
    "provider" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'bank',
    "sourceRecordId" TEXT,
    "fingerprint" TEXT,
    "bankAccountRef" TEXT,
    "entryRef" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "postedAt" TIMESTAMP(3),
    "narration" TEXT,
    "direction" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionSettlementLink" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "matchMethod" TEXT,
    "confidence" DOUBLE PRECISION,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionSettlementLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementBankAllocation" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "bankEntryId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "allocationType" TEXT,
    "matchMethod" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementBankAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "caseType" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "reason" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "sourceEntityType" TEXT,
    "sourceEntityId" TEXT,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAction" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "actionName" TEXT NOT NULL,
    "actionOrder" INTEGER NOT NULL,
    "llmCallCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "caseId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventSummary" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'SYSTEM',
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "raw_records_provider_source_type_source_record_id_unique"
ON "RawRecord" ("provider", "sourceType", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_provider_source_type_source_record_id_unique"
ON "Transaction" ("provider", "sourceType", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_provider_source_type_source_record_id_unique"
ON "Settlement" ("provider", "sourceType", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_entries_provider_source_type_source_record_id_unique"
ON "BankEntry" ("provider", "sourceType", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_settlement_links_transaction_settlement_unique"
ON "TransactionSettlementLink" ("transactionId", "settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_bank_allocations_settlement_bank_unique"
ON "SettlementBankAllocation" ("settlementId", "bankEntryId");

-- CreateIndex
CREATE INDEX "Import_provider_sourceType_createdAt_idx"
ON "Import" ("provider", "sourceType", "createdAt");

-- CreateIndex
CREATE INDEX "RawRecord_importId_idx"
ON "RawRecord" ("importId");

-- CreateIndex
CREATE INDEX "RawRecord_provider_sourceType_sourceRecordId_idx"
ON "RawRecord" ("provider", "sourceType", "sourceRecordId");

-- CreateIndex
CREATE INDEX "Transaction_provider_sourceType_sourceRecordId_idx"
ON "Transaction" ("provider", "sourceType", "sourceRecordId");

-- CreateIndex
CREATE INDEX "Settlement_provider_sourceType_sourceRecordId_idx"
ON "Settlement" ("provider", "sourceType", "sourceRecordId");

-- CreateIndex
CREATE INDEX "SettlementComponent_settlementId_idx"
ON "SettlementComponent" ("settlementId");

-- CreateIndex
CREATE INDEX "SettlementComponent_provider_sourceType_sourceRecordId_idx"
ON "SettlementComponent" ("provider", "sourceType", "sourceRecordId");

-- CreateIndex
CREATE INDEX "BankEntry_provider_sourceType_sourceRecordId_idx"
ON "BankEntry" ("provider", "sourceType", "sourceRecordId");

-- CreateIndex
CREATE INDEX "TransactionSettlementLink_transactionId_idx"
ON "TransactionSettlementLink" ("transactionId");

-- CreateIndex
CREATE INDEX "TransactionSettlementLink_settlementId_idx"
ON "TransactionSettlementLink" ("settlementId");

-- CreateIndex
CREATE INDEX "SettlementBankAllocation_settlementId_idx"
ON "SettlementBankAllocation" ("settlementId");

-- CreateIndex
CREATE INDEX "SettlementBankAllocation_bankEntryId_idx"
ON "SettlementBankAllocation" ("bankEntryId");

-- CreateIndex
CREATE INDEX "Case_state_priority_createdAt_idx"
ON "Case" ("state", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "AgentAction_caseId_actionOrder_idx"
ON "AgentAction" ("caseId", "actionOrder");

-- CreateIndex
CREATE INDEX "AuditEvent_caseId_createdAt_idx"
ON "AuditEvent" ("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx"
ON "AuditEvent" ("entityType", "entityId");

-- Foreign keys
ALTER TABLE "RawRecord"
ADD CONSTRAINT "RawRecord_importId_fkey"
FOREIGN KEY ("importId") REFERENCES "Import"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_importId_fkey"
FOREIGN KEY ("importId") REFERENCES "Import"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "Transaction_rawRecordId_fkey"
FOREIGN KEY ("rawRecordId") REFERENCES "RawRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Settlement"
ADD CONSTRAINT "Settlement_importId_fkey"
FOREIGN KEY ("importId") REFERENCES "Import"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "Settlement_rawRecordId_fkey"
FOREIGN KEY ("rawRecordId") REFERENCES "RawRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SettlementComponent"
ADD CONSTRAINT "SettlementComponent_settlementId_fkey"
FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BankEntry"
ADD CONSTRAINT "BankEntry_importId_fkey"
FOREIGN KEY ("importId") REFERENCES "Import"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "BankEntry_rawRecordId_fkey"
FOREIGN KEY ("rawRecordId") REFERENCES "RawRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TransactionSettlementLink"
ADD CONSTRAINT "TransactionSettlementLink_transactionId_fkey"
FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "TransactionSettlementLink_settlementId_fkey"
FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SettlementBankAllocation"
ADD CONSTRAINT "SettlementBankAllocation_settlementId_fkey"
FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "SettlementBankAllocation_bankEntryId_fkey"
FOREIGN KEY ("bankEntryId") REFERENCES "BankEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentAction"
ADD CONSTRAINT "AgentAction_caseId_fkey"
FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
ADD CONSTRAINT "AuditEvent_caseId_fkey"
FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;
