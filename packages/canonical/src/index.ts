import { type CurrencyCode, type ProviderName, type SourceType } from '@anvaya/contracts';

export type CanonicalRecordIdentity = {
  provider: ProviderName;
  sourceType: SourceType;
  sourceRecordId: string;
};

export type CanonicalFinancialEffect = {
  provider: ProviderName;
  sourceType: SourceType;
  sourceRecordId: string;
  amountMinor: number;
  currency: CurrencyCode;
  financialEffectMinor: number;
};

export function buildSourceRecordKey(identity: CanonicalRecordIdentity): string {
  return `${identity.provider}:${identity.sourceType}:${identity.sourceRecordId}`;
}

export function createCanonicalFinancialEffect(input: {
  provider: ProviderName;
  sourceType: SourceType;
  sourceRecordId: string;
  amountMinor: number;
  currency: CurrencyCode;
  financialEffectMinor: number;
}): CanonicalFinancialEffect {
  if (!Number.isInteger(input.amountMinor) || !Number.isInteger(input.financialEffectMinor)) {
    throw new Error('Financial amounts must use integer minor units.');
  }

  if (!input.sourceRecordId.trim()) {
    throw new Error('sourceRecordId is required for canonical financial effects.');
  }

  return {
    ...input,
  };
}

export function assertSourceRecordUniqueness(
  existing: CanonicalFinancialEffect[],
  candidate: CanonicalFinancialEffect,
): void {
  const duplicate = existing.some((record) => {
    return (
      record.provider === candidate.provider &&
      record.sourceType === candidate.sourceType &&
      record.sourceRecordId === candidate.sourceRecordId
    );
  });

  if (duplicate) {
    throw new Error(
      `Duplicate canonical financial effect for provider=${candidate.provider}, sourceType=${candidate.sourceType}, sourceRecordId=${candidate.sourceRecordId}.`,
    );
  }
}

export function appendCanonicalFinancialEffect(
  existing: CanonicalFinancialEffect[],
  candidate: CanonicalFinancialEffect,
): CanonicalFinancialEffect[] {
  assertSourceRecordUniqueness(existing, candidate);
  return [...existing, candidate];
}

export function isStableSourceIdentity(identity: Partial<CanonicalRecordIdentity>): boolean {
  return Boolean(identity.provider && identity.sourceType && identity.sourceRecordId);
}
