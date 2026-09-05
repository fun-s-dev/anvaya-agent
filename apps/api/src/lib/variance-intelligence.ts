export type VarianceCase = {
  id: string;
  caseType?: string;
  reason?: string | null;
  state?: string;
  priority?: string;
  amountMinor?: number;
  evidenceFound?: string[];
  evidenceRequired?: string[];
  relationshipCount?: number;
  explanation?: string;
};

export function deriveVarianceIntelligence(cases: VarianceCase[], metrics?: Record<string, unknown>) {
  const groups = new Map<string, {
    key: string; reason: string; caseType: string; count: number; amountMinor: number; relationshipCount: number;
    states: Record<string, number>; priorities: Record<string, number>; caseIds: string[]; evidenceFound: string[]; evidenceMissing: string[];
  }>();
  for (const item of cases) {
    const reason = item.reason || 'UNSPECIFIED';
    const caseType = item.caseType || 'UNKNOWN';
    const key = `${reason}:${caseType}`;
    const group = groups.get(key) ?? {
      key, reason, caseType, count: 0, amountMinor: 0, relationshipCount: 0, states: {}, priorities: {}, caseIds: [], evidenceFound: [], evidenceMissing: [],
    };
    group.count += 1;
    group.amountMinor += Number(item.amountMinor ?? 0);
    group.relationshipCount += Number(item.relationshipCount ?? 1);
    group.evidenceFound.push(...(item.evidenceFound ?? []));
    group.evidenceMissing.push(...(item.evidenceRequired ?? []));
    group.states[item.state || 'UNKNOWN'] = (group.states[item.state || 'UNKNOWN'] || 0) + 1;
    group.priorities[item.priority || 'UNKNOWN'] = (group.priorities[item.priority || 'UNKNOWN'] || 0) + 1;
    group.caseIds.push(item.id);
    groups.set(key, group);
  }
  const grouped = [...groups.values()].map((group) => ({
    ...group,
    evidenceFound: [...new Set(group.evidenceFound)].sort(),
    evidenceMissing: [...new Set(group.evidenceMissing)].sort(),
    explanation: `Deterministic grouping of ${group.count} persisted ${group.caseType} case${group.count === 1 ? '' : 's'} with reason ${group.reason}.`,
    requiredNextEvidence: [...new Set(group.evidenceMissing)].sort(),
  })).sort((a, b) => b.amountMinor - a.amountMinor || a.reason.localeCompare(b.reason) || a.caseType.localeCompare(b.caseType));
  const unresolvedAmountMinor = cases.filter((item) => item.state !== 'VERIFIED').reduce((sum, item) => sum + Number(item.amountMinor ?? 0), 0);
  const cleanRun = cases.length === 0 || (grouped.length === 0 && unresolvedAmountMinor === 0 && Number(metrics?.unresolvedValueMinor ?? 0) === 0);
  const primary = cleanRun ? null : grouped[0];
  const evidenceFound = [...new Set(cases.flatMap((item) => item.evidenceFound ?? []))].sort();
  const evidenceMissing = [...new Set(cases.flatMap((item) => item.evidenceRequired ?? []))].sort();
  const primaryReason = cleanRun ? 'CLEAN' : (primary?.reason ?? null);
  const operationalExplanation = cleanRun
    ? 'All required relationships were reconciled and validated.'
    : primary ? `Primary operational driver is ${primary.reason}, affecting ${primary.relationshipCount} relationship${primary.relationshipCount === 1 ? '' : 's'}.` : 'No unresolved variance was persisted for this run.';
  return {
    totalCases: cases.length,
    totalVarianceMinor: cases.reduce((sum, item) => sum + Number(item.amountMinor ?? 0), 0),
    unresolvedAmountMinor,
    caseCount: cases.length,
    primaryReason,
    affectedRelationshipCount: cases.reduce((sum, item) => sum + Number(item.relationshipCount ?? 1), 0),
    evidenceFound: cleanRun ? ['Required source relationships validated.'] : evidenceFound,
    evidenceMissing: cleanRun ? ['None.'] : evidenceMissing,
    requiredNextEvidence: cleanRun ? ['None.'] : evidenceMissing,
    operationalExplanation,
    drivers: grouped.map((group) => ({ reason: group.reason, amountMinor: group.amountMinor, caseCount: group.count, relationshipCount: group.relationshipCount, evidenceFound: group.evidenceFound, evidenceMissing: group.evidenceMissing, explanation: group.explanation, requiredNextEvidence: group.requiredNextEvidence })),
    groups: grouped,
    metrics: metrics ?? {},
    derivedFrom: 'persisted run cases',
  };
}
