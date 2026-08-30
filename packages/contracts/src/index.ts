import { z } from 'zod';

export const CurrencyCodeSchema = z.enum(['INR', 'USD', 'EUR']);
export const SourceTypeSchema = z.enum(['merchant', 'psp', 'bank']);
export const ProviderNameSchema = z.enum(['razorpay', 'mock-provider']);

export const MoneyMinorSchema = z.number().int();

export const ImportRegistrationRequestSchema = z.object({
  provider: ProviderNameSchema,
  sourceType: SourceTypeSchema,
  filename: z.string().min(1).max(255),
  checksum: z.string().min(8).max(128),
  fileSizeBytes: z.number().int().nonnegative(),
  createdAt: z.string().datetime().optional(),
  importedAt: z.string().datetime().optional(),
  sourceRecordCount: z.number().int().nonnegative().optional().default(0),
});

export const ImportResponseSchema = z.object({
  id: z.string(),
  provider: ProviderNameSchema,
  sourceType: SourceTypeSchema,
  filename: z.string(),
  checksum: z.string(),
  fileSizeBytes: z.number().int().nonnegative(),
  status: z.enum(['received', 'validated', 'rejected']),
  createdAt: z.string().datetime(),
  importedAt: z.string().datetime(),
  sourceRecordCount: z.number().int().nonnegative(),
});

export const CanonicalFinancialEffectSchema = z.object({
  provider: ProviderNameSchema,
  sourceType: SourceTypeSchema,
  sourceRecordId: z.string().min(1),
  amountMinor: MoneyMinorSchema,
  currency: CurrencyCodeSchema,
  financialEffectMinor: MoneyMinorSchema,
});

export const ApiErrorSchema = z.object({
  error: z.string(),
  details: z.string().optional(),
});

export type ProviderName = z.infer<typeof ProviderNameSchema>;
export type SourceType = z.infer<typeof SourceTypeSchema>;
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;
export type ImportRegistrationRequest = z.infer<typeof ImportRegistrationRequestSchema>;
export type ImportResponse = z.infer<typeof ImportResponseSchema>;
export type CanonicalFinancialEffect = z.infer<typeof CanonicalFinancialEffectSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
