import { GoogleGenerativeAI } from '@google/generative-ai';

export type AskIntent =
  | { type: 'METRIC_LOOKUP'; metric: string }
  | { type: 'COUNT_CASES'; state?: 'VERIFIED' | 'PENDING' | 'ESCALATED' }
  | { type: 'HIGHEST_IMPACT_CASE' }
  | { type: 'LIST_CASES'; state: 'PENDING' | 'ESCALATED' | 'VERIFIED' }
  | { type: 'MISSING_EVIDENCE' }
  | { type: 'UNKNOWN' };

const fmt = (minor: number) => `\u20b9 ${(minor / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

// ---------------------------------------------------------------------------
// Fast heuristic intent matching - deterministic, no model needed
// ---------------------------------------------------------------------------
function heuristicIntent(question: string): AskIntent | null {
  const q = question.toLowerCase();

  // Metric lookups
  if (q.includes('how much remains unresolved') || q.includes('unresolved variance') || q.includes('unresolved value') || (q.includes('unresolved') && q.includes('much'))) {
    return { type: 'METRIC_LOOKUP', metric: 'unresolvedValueMinor' };
  }
  if (q.includes('transaction to settlement match rate') || (q.includes('match rate') && !q.includes('settlement to bank'))) {
    return { type: 'METRIC_LOOKUP', metric: 'transactionToSettlementMatchRate' };
  }
  if (q.includes('settlement to bank match rate')) {
    return { type: 'METRIC_LOOKUP', metric: 'settlementToBankMatchRate' };
  }
  if (q.includes('ai investigation calls') || q.includes('llm usage') || q.includes('ai calls')) {
    return { type: 'METRIC_LOOKUP', metric: 'llmCallsUsed' };
  }
  if (q.includes('how many records') || q.includes('total records') || q.includes('batch size')) {
    return { type: 'METRIC_LOOKUP', metric: 'batchRecordCount' };
  }

  // Case counts
  if (q.includes('escalated cases') || q.includes('how many cases were escalated') || q.includes('how many escalated') || (q.includes('escalated') && q.includes('how many'))) {
    return { type: 'COUNT_CASES', state: 'ESCALATED' };
  }
  if (q.includes('pending cases') || q.includes('how many cases are pending') || (q.includes('pending') && q.includes('how many'))) {
    return { type: 'COUNT_CASES', state: 'PENDING' };
  }
  if (q.includes('verified cases') || q.includes('how many cases were verified') || (q.includes('verified') && q.includes('how many'))) {
    return { type: 'COUNT_CASES', state: 'VERIFIED' };
  }
  if (q.includes('how many cases') || q.includes('total cases') || q.includes('case count')) {
    return { type: 'COUNT_CASES' };
  }

  // Highest impact
  if (q.includes('highest impact') || q.includes('largest case') || q.includes('biggest discrepancy') || q.includes('largest unresolved') || q.includes('which transaction has the largest')) {
    return { type: 'HIGHEST_IMPACT_CASE' };
  }

  // List cases by state
  if ((q.includes('show me all pending') || q.includes('list pending') || (q.includes('pending') && q.includes('show'))) && !q.includes('how many')) {
    return { type: 'LIST_CASES', state: 'PENDING' };
  }
  if ((q.includes('show me all escalated') || q.includes('list escalated') || (q.includes('escalated') && q.includes('show'))) && !q.includes('how many')) {
    return { type: 'LIST_CASES', state: 'ESCALATED' };
  }
  if ((q.includes('show me all verified') || q.includes('list verified') || (q.includes('verified') && q.includes('show'))) && !q.includes('how many')) {
    return { type: 'LIST_CASES', state: 'VERIFIED' };
  }

  // Missing evidence
  if (q.includes('what evidence is missing') || q.includes('missing evidence') || q.includes('evidence missing') || q.includes('what is missing')) {
    return { type: 'MISSING_EVIDENCE' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Optional Gemini LLM fallback - maps to a strict structured intent only.
// Gemini NEVER calculates financial values or produces authoritative financial truth.
// ---------------------------------------------------------------------------
async function llmIntent(question: string): Promise<AskIntent> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { type: 'UNKNOWN' };

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = `You are an intent parser for a financial reconciliation system. Your only job is to classify the question into one of the supported intent types. Do not answer the question. Do not make up financial values.

Available intents (output strict JSON only):
1. {"type": "METRIC_LOOKUP", "metric": "unresolvedValueMinor" | "transactionToSettlementMatchRate" | "settlementToBankMatchRate" | "llmCallsUsed" | "batchRecordCount"}
2. {"type": "COUNT_CASES", "state": "VERIFIED" | "PENDING" | "ESCALATED" | null}
3. {"type": "HIGHEST_IMPACT_CASE"}
4. {"type": "LIST_CASES", "state": "PENDING" | "ESCALATED" | "VERIFIED"}
5. {"type": "MISSING_EVIDENCE"}
6. {"type": "UNKNOWN"}

Question: "${question.slice(0, 200)}"
JSON:`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const match = text.match(/\{[^{}]+\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as AskIntent;
      if (['METRIC_LOOKUP', 'COUNT_CASES', 'HIGHEST_IMPACT_CASE', 'LIST_CASES', 'MISSING_EVIDENCE'].includes(parsed.type)) {
        return parsed;
      }
    }
  } catch {
    // Silently fall through to UNKNOWN - do not let model errors surface as exceptions
  }
  return { type: 'UNKNOWN' };
}

export async function parseIntent(question: string): Promise<AskIntent> {
  const intent = heuristicIntent(question);
  if (intent) return intent;
  return llmIntent(question);
}

// ---------------------------------------------------------------------------
// Deterministic execution - all financial values come from persisted DB metrics/cases.
// Gemini never executes here.
// ---------------------------------------------------------------------------
export function executeIntent(
  intent: AskIntent,
  runId: string,
  metrics: Record<string, number>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cases: any[],
): { answer: string; citations: string[]; grounded: boolean } {
  if (intent.type === 'UNKNOWN') {
    return {
      answer: "That question is not supported by the current evidence ledger. Try asking about unresolved amounts, case counts, escalated cases, or the highest-impact case.",
      citations: [],
      grounded: false,
    };
  }

  if (intent.type === 'METRIC_LOOKUP') {
    const val = metrics[intent.metric];
    if (val === undefined || val === null) {
      return { answer: `Metric '${intent.metric}' is not available for this run.`, citations: [], grounded: true };
    }
    if (intent.metric.includes('ValueMinor')) {
      return { answer: `The unresolved variance for this run is ${fmt(val)}.`, citations: [], grounded: true };
    }
    if (intent.metric.includes('Rate')) {
      const label = intent.metric === 'transactionToSettlementMatchRate' ? 'transaction-to-settlement' : 'settlement-to-bank';
      return { answer: `The ${label} match rate is ${(val * 100).toFixed(1)}%.`, citations: [], grounded: true };
    }
    if (intent.metric === 'llmCallsUsed') {
      return { answer: `This run used ${val} AI investigation call${val === 1 ? '' : 's'} out of a budget of ${metrics['llmCallBudget'] ?? metrics['llmCallsUsed'] ?? 'unknown'}.`, citations: [], grounded: true };
    }
    if (intent.metric === 'batchRecordCount') {
      return { answer: `This run processed ${val.toLocaleString('en-IN')} records in total.`, citations: [], grounded: true };
    }
    return { answer: `The value for ${intent.metric} is ${val}.`, citations: [], grounded: true };
  }

  if (intent.type === 'COUNT_CASES') {
    if (intent.state) {
      const filtered = cases.filter(c => c.state === intent.state);
      const stateLabel = intent.state.charAt(0) + intent.state.slice(1).toLowerCase();
      return {
        answer: `This run has ${filtered.length} ${stateLabel} case${filtered.length === 1 ? '' : 's'}.`,
        citations: filtered.map(c => c.id).slice(0, 5),
        grounded: true,
      };
    }
    return { answer: `This run has a total of ${cases.length} case${cases.length === 1 ? '' : 's'}.`, citations: [], grounded: true };
  }

  if (intent.type === 'HIGHEST_IMPACT_CASE') {
    const sorted = [...cases].sort((a, b) => Number(b.amountMinor ?? 0) - Number(a.amountMinor ?? 0));
    const highest = sorted[0];
    if (!highest) return { answer: 'No cases found for this run.', citations: [], grounded: true };
    const reason = (highest.reason ?? 'unknown reason').replace(/_/g, ' ').toLowerCase();
    return {
      answer: `The highest-impact case is ${highest.id} at ${fmt(Number(highest.amountMinor ?? 0))} due to ${reason}. State: ${highest.state}.`,
      citations: [highest.id],
      grounded: true,
    };
  }

  if (intent.type === 'LIST_CASES') {
    const filtered = cases.filter(c => c.state === intent.state);
    if (!filtered.length) {
      return { answer: `No ${intent.state.toLowerCase()} cases in this run.`, citations: [], grounded: true };
    }
    const top = filtered.slice(0, 10);
    const items = top.map(c => `${c.id} (${fmt(Number(c.amountMinor ?? 0))})`).join(', ');
    const more = filtered.length > 10 ? ` ... and ${filtered.length - 10} more.` : '.';
    return {
      answer: `${intent.state} cases: ${items}${more}`,
      citations: top.map(c => c.id),
      grounded: true,
    };
  }

  if (intent.type === 'MISSING_EVIDENCE') {
    const missing = cases.flatMap(c => {
      const ev = c.evidenceRequired ?? c.evidenceMissing ?? [];
      return Array.isArray(ev) ? ev : [];
    });
    const unique = [...new Set(missing as string[])].slice(0, 8);
    if (!unique.length) return { answer: 'No missing evidence types recorded for this run.', citations: [], grounded: true };
    return {
      answer: `Evidence types missing in this run: ${unique.join(', ')}.`,
      citations: [],
      grounded: true,
    };
  }

  return { answer: 'Error processing intent.', citations: [], grounded: false };
}
