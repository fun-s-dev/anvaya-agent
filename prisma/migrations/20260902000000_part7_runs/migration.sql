CREATE TABLE "ReconciliationRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "importIds" JSONB NOT NULL,
  "metrics" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3)
);
CREATE INDEX "ReconciliationRun_createdAt_idx" ON "ReconciliationRun"("createdAt");
ALTER TABLE "Case" ADD COLUMN "runId" TEXT;
CREATE INDEX "Case_runId_idx" ON "Case"("runId");
ALTER TABLE "Case" ADD CONSTRAINT "Case_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
