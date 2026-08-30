export const scenarioMutationCatalog = [
  'wrong_amount',
  'missing_settlement',
  'reference_truncation',
  'ambiguous_reference',
  'settlement_component_integrity_break',
] as const;

export function describeScenarioConfig(seed: number, size: number) {
  return {
    seed,
    size,
    publicMode: 'synthetic',
  };
}
