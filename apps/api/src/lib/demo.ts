import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const DEMO_RETENTION_DAYS = 7;

export type UploadValidationInput = {
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  content?: string;
};

export type CsvUploadValidation = {
  valid: boolean;
  filename: string;
  privateFilename: string;
  reason?: string;
};

export function generatePrivateStorageName(originalFilename: string) {
  const safeBase = originalFilename.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'upload';
  return `anvaya-private-${randomUUID()}-${safeBase}`;
}

export function validateCsvUpload(input: UploadValidationInput): CsvUploadValidation {
  const filename = (input.filename ?? '').trim();
  const sizeBytes = Number(input.sizeBytes ?? 0);
  const mimeType = (input.mimeType ?? '').toLowerCase();
  const normalizedName = filename.toLowerCase();

  if (!normalizedName.endsWith('.csv')) {
    return { valid: false, filename, privateFilename: generatePrivateStorageName(filename), reason: 'Only .csv uploads are accepted.' };
  }

  if (sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_BYTES) {
    return { valid: false, filename, privateFilename: generatePrivateStorageName(filename), reason: 'CSV file is missing or exceeds the 5 MB upload limit.' };
  }

  const allowedMimeTypes = ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'];
  if (mimeType && !allowedMimeTypes.includes(mimeType)) {
    return { valid: false, filename, privateFilename: generatePrivateStorageName(filename), reason: 'Unsupported CSV MIME type; file validation rejected.' };
  }

  if (input.content) {
    const leadingBytes = input.content.slice(0, 256).replace(/\r/g, '');
    if (!leadingBytes.includes(',') && !leadingBytes.includes('\n') && !leadingBytes.includes(';')) {
      return { valid: false, filename, privateFilename: generatePrivateStorageName(filename), reason: 'CSV content appears invalid or not tabular data.' };
    }
  }

  return {
    valid: true,
    filename,
    privateFilename: generatePrivateStorageName(filename),
  };
}

export function deleteTemporarySourceFile(filePath?: string | null) {
  if (!filePath) return;
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true });
  }
}

/**
 * @internal TEST ONLY - never use in production routes.
 * Static metric fixtures for test assertions and demo UI only.
 * Production metrics MUST be computed from actual reconciliation run output.
 */
export const demoMetrics = {
  batchRecordCount: 500,
  matchRateTransactionSettlement: 0.962,
  matchRateSettlementBank: 0.948,
  verifiedValueMinor: 2384000,
  pendingValueMinor: 182000,
  unresolvedValueMinor: 245000,
  humanReviewRate: 0.094,
  throughputPerHour: 1850,
  llmCallsUsed: 4,
  llmCallBudget: 20,
  falseResolutionRate: 0.012,
  explainedVarianceMinor: 421000,
  unexplainedVarianceMinor: 245000,
  verifiedCases: 168,
  pendingCases: 18,
  escalatedCases: 9,
};

/**
 * @internal TEST ONLY - never use in production routes.
 * Returns a static hardcoded case queue for test assertions only.
 * Production cases MUST come from actual persisted Case records.
 * Static IDs like CASE-1047, CASE-1048, CASE-1049 must NOT appear in API responses.
 */
export function getDemoCaseQueue() {
  return [
    {
      id: 'CASE-1047',
      priority: 'High',
      rupeeImpactMinor: 245000,
      state: 'ESCALATED',
      reason: 'MISSING_BANK_CREDIT',
      evidenceFound: ['bank-entry-3042', 'settlement-9009'],
      evidenceRequired: ['bank narration cross-check', 'settlement trace'],
      deterministicPriority: ['amount > 200000', 'timing mismatch', 'unattributed bank entry'],
    },
    {
      id: 'CASE-1048',
      priority: 'Medium',
      rupeeImpactMinor: 92500,
      state: 'PENDING',
      reason: 'TIMING_DELAY',
      evidenceFound: ['settlement-9018'],
      evidenceRequired: ['bank credit expected within 2 business days'],
      deterministicPriority: ['delay window inside policy'],
    },
    {
      id: 'CASE-1049',
      priority: 'Low',
      rupeeImpactMinor: 18000,
      state: 'VERIFIED',
      reason: 'BANK_MATCH',
      evidenceFound: ['bank-entry-3081'],
      evidenceRequired: [],
      deterministicPriority: ['verified trace match'],
    },
  ];
}

export function buildDemoDataset() {
  return {
    generatedAt: new Date().toISOString(),
    datasetName: 'synthetic-demo-seed-42',
    files: [
      'merchant_transactions.csv',
      'settlement_records.csv',
      'bank_statement.csv',
    ],
    retentionDays: DEMO_RETENTION_DAYS,
    note: 'Synthetic data only; no production financial records are used in the demo.',
  };
}

export type PersistedImport = {
  id: string;
  provider: string;
  sourceType: string;
  filename: string;
  checksum: string;
  fileSizeBytes: number;
  status: 'received' | 'validated' | 'rejected';
  createdAt: string;
  importedAt: string;
  rawRecords: Array<{ id: string; sourceRecordId: string; row: Record<string, string> }>;
};

export type PersistedRun = {
  runId: string;
  status: 'complete' | 'failed';
  asOf: string;
  importIds: string[];
  metrics: Record<string, number>;
  cases: Array<{ id: string; caseType: string; priority: string; amountMinor: number; rupeeImpactMinor: number; state: string; reason: string; evidenceFound: string[]; evidenceRequired: string[]; deterministicPriority: string[]; createdAt?: string }>;
  proofs: Record<string, Record<string, unknown>>;
};

/** Deliberately scoped to tests and the demo when PostgreSQL is unavailable. */
export const memoryStore = {
  imports: new Map<string, PersistedImport>(),
  runs: new Map<string, PersistedRun>(),
  activeRunId: undefined as string | undefined,
  reset() { this.imports.clear(); this.runs.clear(); this.activeRunId = undefined; },
};

export function useMemoryStore() {
  return process.env.ANVAYA_DEMO_STORE === 'memory' || !process.env.DATABASE_URL;
}

export function parseCsv(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === '"') {
      if (quoted && content[i + 1] === '"') { cell += '"'; i += 1; } else quoted = !quoted;
    } else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && content[i + 1] === '\n') i += 1;
      row.push(cell); if (row.some((v) => v.trim())) rows.push(row); row = []; cell = '';
    } else cell += ch;
  }

  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length || !rows[0]?.length) throw new Error('CSV is empty.');
  const headers = rows[0].map((h) => h.trim());
  if (headers.some((h) => !h || !/^[A-Za-z0-9_ -]+$/.test(h))) throw new Error('CSV header is malformed.');
  return rows.slice(1).map((values) => {
    if (values.length !== headers.length) throw new Error('CSV row has a different number of columns than the header.');
    return Object.fromEntries(headers.map((header, i) => [header, values[i]?.trim() ?? '']));
  });
}

export function requiredColumnsFor(sourceType: 'merchant' | 'psp' | 'bank'): string[] {
  return sourceType === 'merchant'
    ? ['source_record_id', 'external_ref', 'amount_minor', 'currency', 'transaction_date']
    : sourceType === 'psp'
      ? ['settlement_source_record_id', 'stated_amount_minor', 'currency', 'settlement_date', 'psp_transaction_id', 'transaction_ref', 'component_amount_minor', 'financial_effect_minor']
      : ['source_record_id', 'entry_ref', 'amount_minor', 'currency', 'posted_at', 'direction'];
}

export function validateRequiredColumns(rows: Record<string, string>[], sourceType: 'merchant' | 'psp' | 'bank'): string | undefined {
  const missing = requiredColumnsFor(sourceType).filter((column) => !(column in (rows[0] ?? {})));
  return missing.length ? `Missing required ${sourceType} CSV columns: ${missing.join(', ')}` : undefined;
}

export function demoCsvContent(sourceType: 'merchant' | 'psp' | 'bank') {
  const filename = sourceType === 'merchant' ? 'merchant_transactions.csv' : sourceType === 'psp' ? 'settlement_records.csv' : 'bank_statement.csv';
  const candidates = [
    join(process.cwd(), 'data', 'demo', filename),
    join(process.cwd(), '..', '..', 'data', 'demo', filename),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) throw new Error(`Demo source file is unavailable: ${filename}`);
  return readFileSync(path, 'utf8');
}
