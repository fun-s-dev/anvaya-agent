import { describe, expect, it } from 'vitest';

import { buildDemoDataset, deleteTemporarySourceFile, validateCsvUpload } from './demo.js';

describe('demo upload and retention helpers', () => {
  it('accepts a valid csv upload and generates a private storage name', () => {
    const result = validateCsvUpload({
      filename: 'merchant_transactions.csv',
      mimeType: 'text/csv',
      sizeBytes: 2048,
      content: 'merchant_id,amount_minor\nM-1,2500\n',
    });

    expect(result.valid).toBe(true);
    expect(result.privateFilename).toMatch(/^anvaya-private-[a-z0-9-]+-merchant_transactions\.csv$/i);
    expect(result.privateFilename).not.toBe('merchant_transactions.csv');
  });

  it('rejects non-csv or oversized uploads', () => {
    const result = validateCsvUpload({ filename: 'statement.xlsx', mimeType: 'application/vnd.ms-excel', sizeBytes: 1024 });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Only \.csv uploads/);

    const oversized = validateCsvUpload({
      filename: 'bank_statement.csv',
      mimeType: 'text/csv',
      sizeBytes: 10 * 1024 * 1024,
      content: 'entry_ref,amount_minor\n',
    });
    expect(oversized.valid).toBe(false);
    expect(oversized.reason).toMatch(/5 MB/);
  });

  it('keeps demo dataset metadata and demo retention policy explicit', () => {
    const dataset = buildDemoDataset();

    expect(dataset.files).toEqual(['merchant_transactions.csv', 'settlement_records.csv', 'bank_statement.csv']);
    expect(dataset.note).toContain('Synthetic data only');
    expect(dataset.retentionDays).toBeGreaterThan(0);
  });

  it('deleteTemporarySourceFile is safe for missing files', () => {
    expect(() => deleteTemporarySourceFile('/tmp/nonexistent-demo.csv')).not.toThrow();
  });
});
