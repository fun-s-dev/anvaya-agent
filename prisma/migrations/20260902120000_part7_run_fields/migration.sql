-- Migration: Part 7 run fields and import idempotency
-- Adds provider, startedAt, durationMs to ReconciliationRun
-- Adds unique constraint on Import (provider, sourceType, checksum) for idempotency

-- Add provider column to ReconciliationRun
ALTER TABLE "ReconciliationRun" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'razorpay';

-- Add startedAt column to ReconciliationRun
ALTER TABLE "ReconciliationRun" ADD COLUMN "startedAt" TIMESTAMP(3);

-- Add durationMs column to ReconciliationRun
ALTER TABLE "ReconciliationRun" ADD COLUMN "durationMs" INTEGER;

-- Add index on status+createdAt for efficient run lookups
CREATE INDEX "ReconciliationRun_status_createdAt_idx" ON "ReconciliationRun"("status", "createdAt");

-- Add unique constraint on Import for idempotency
-- This prevents duplicate imports of the same source file
CREATE UNIQUE INDEX "imports_provider_source_type_checksum_unique" ON "Import"("provider", "sourceType", "checksum");
