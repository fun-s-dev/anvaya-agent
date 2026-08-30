export const deterministicFastPath = [
  'settlement_integrity',
  'exact_reference',
  'normalized_reference',
  'amount_and_date_window',
  'aggregate_allocation',
  'timing_policy',
] as const;

export type DeterministicFastPathStep = (typeof deterministicFastPath)[number];

export function validateDeterministicFastPath(step: string): void {
  if (!deterministicFastPath.includes(step as DeterministicFastPathStep)) {
    throw new Error(`Unsupported deterministic reconciliation step: ${step}`);
  }
}

export function explainFastPath(): string[] {
  return [...deterministicFastPath];
}
