export type Metrics = Record<string, number | string> & { datasetName?: string; verifiedCases?: number; pendingCases?: number; escalatedCases?: number; unresolvedValueMinor?: number; batchRecordCount?: number; matchRateTransactionSettlement?: number };
export type Case = { id: string; runId?: string; state: string; reason: string | null; priority: string; amountMinor: number; evidenceFound: string[]; evidenceRequired: string[]; deterministicPriority?: string[]; agentInvolvement?: boolean };
export type VarianceDriver = { reason: string; amountMinor: number; caseCount: number; relationshipCount: number; evidenceFound: string[]; evidenceMissing: string[]; explanation: string; requiredNextEvidence: string[] };
export type Run = { runId: string; status: string; asOf: string; startedAt?: string; completedAt?: string; durationMs?: number; metrics: Metrics; cases?: Case[]; variance?: { unresolvedAmountMinor: number; caseCount: number; primaryReason: string | null; affectedRelationshipCount: number; evidenceFound: string[]; evidenceMissing: string[]; operationalExplanation: string; requiredNextEvidence: string[]; drivers: VarianceDriver[] } };
export type AskResponse = { runId: string; question: string; answer: string; grounded: boolean; unavailable?: boolean; citations?: string[]; data?: Record<string, unknown> };
export type AgentAction = { id: string; actionName: string; llmCallCount: number; status: string; payload?: Record<string, unknown>; result?: Record<string, unknown> };
export type ProofResponse = Case & { agentActions: AgentAction[]; evidence?: Record<string, unknown> };
const base = process.env.NEXT_PUBLIC_API_URL ?? '';
async function request<T>(path: string, init?: RequestInit): Promise<T> { const response = await fetch(`${base}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } }); if (!response.ok) throw new Error((await response.json().catch(() => null) as { error?: string } | null)?.error ?? `API request failed (${response.status})`); return response.json() as Promise<T>; }
export const api = {
  demo: (scenario?: string) => request<{ importIds: string[]; files: string[] }>('/demo/generate', { method: 'POST', body: JSON.stringify({ scenario }) }),
  importCsv: (payload: Record<string, unknown>) => request<{ id: string }>('/imports', { method: 'POST', body: JSON.stringify(payload) }),
  run: (importIds: string[]) => request<Run>('/reconciliation/runs', { method: 'POST', body: JSON.stringify({ import_ids: importIds }) }),
  // NOTE: api.runs() (global listing) is intentionally removed - no-auth product must not expose historical runs.
  runById: (id: string) => request<Run>(`/reconciliation/runs/${encodeURIComponent(id)}`),
  cases: (runId?: string) => request<{ data: Case[] }>(runId ? `/cases?runId=${encodeURIComponent(runId)}` : '/cases'),
  proof: (id: string) => request<ProofResponse>(`/cases/${encodeURIComponent(id)}/proof`),
  proofForRun: (runId: string, caseId: string) => request<ProofResponse>(`/runs/${encodeURIComponent(runId)}/cases/${encodeURIComponent(caseId)}/proof`),
  variance: (runId: string) => request<Run['variance']>(`/reconciliation/runs/${encodeURIComponent(runId)}/variance`),
  ask: (runId: string, question: string) => request<AskResponse>('/ask-anvaya', { method: 'POST', body: JSON.stringify({ runId, question }) }),
};
