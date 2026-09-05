'use client';

import { useMemo, useState } from 'react';
import { api, type AskResponse, type Case, type Run } from '../lib/api';

const money = (minor: number | string | undefined) => minor === undefined ? '-' : `\u20b9 ${(Number(minor) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percent = (value: number | string | undefined) => value === undefined ? '-' : `${(Number(value) * 100).toFixed(1)}%`;
const title = (value: string | null | undefined) => {
  const normalized = (value ?? 'CLEAN').toUpperCase();
  if (normalized === 'CLEAN') return 'ALL CLEAR';
  if (normalized === 'UNATTRIBUTED_BANK_ENTRY') return 'EXCESS BANK CREDIT';
  if (normalized === 'MISSING_BANK_CREDIT') return 'MISSING BANK CREDIT';
  if (normalized === 'AMOUNT_MISMATCH') return 'AMOUNT MISMATCH';
  if (normalized === 'TIMING_DELAY') return 'TIMING DELAY';
  return normalized.replaceAll('_', ' ');
};

const getDriverClass = (reason: string | null | undefined) => {
  const r = (reason ?? 'CLEAN').toUpperCase();
  if (r === 'CLEAN') return 'verified';
  if (r === 'AMOUNT_MISMATCH' || r === 'UNATTRIBUTED_BANK_ENTRY' || r === 'MISSING_BANK_CREDIT') return 'unresolved';
  if (r === 'TIMING_DELAY') return 'pending';
  if (r === 'ESCALATED') return 'escalated';
  if (r === 'VERIFIED') return 'verified';
  if (r === 'EXPLAINED') return 'explained';
  return 'unresolved';
};

/** Distinctive Anvaya logo mark: two converging paths meeting at a verified node,
 *  evoking merchant -> settlement -> bank reconciliation into a single verified truth. */
const AnvayaMark = () => (
  <svg
    aria-label="Anvaya"
    className="anvaya-mark"
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Left leg: merchant stream */}
    <path d="M4 28 L16 6" stroke="#c5a35a" strokeWidth="2" strokeLinecap="round" />
    {/* Right leg: bank stream */}
    <path d="M28 28 L16 6" stroke="#c5a35a" strokeWidth="2" strokeLinecap="round" />
    {/* Cross-bar: settlement bridge / reconciliation link */}
    <path d="M9 19 L23 19" stroke="#c5a35a" strokeWidth="1.5" strokeLinecap="round" />
    {/* Apex node: verified relationship */}
    <circle cx="16" cy="6" r="2.5" fill="#c5a35a" />
    {/* Settlement node */}
    <circle cx="9" cy="19" r="1.5" fill="none" stroke="#c5a35a" strokeWidth="1.25" />
    <circle cx="23" cy="19" r="1.5" fill="none" stroke="#c5a35a" strokeWidth="1.25" />
  </svg>
);

const Icon = ({ name }: { name: 'pulse' | 'shield' | 'alert' | 'search' }) => <svg aria-hidden="true" className="icon" viewBox="0 0 24 24"><path d={name === 'pulse' ? 'M3 12h4l2-7 4 14 2-7h6' : name === 'shield' ? 'M12 3l7 3v5c0 4.7-3 8-7 10-4-2-7-5.3-7-10V6l7-3z' : name === 'alert' ? 'M12 4l8 16H4L12 4zM12 9v5m0 3v.1' : 'M11 4a7 7 0 105 12l4 4m-4-4l-4-4'} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>;

export default function ControlRoom() {
  const [run, setRun] = useState<Run | null>(null);
  const [cases, setCases] = useState<Case[]>([]);
  const [proof, setProof] = useState<Record<string, unknown> | null>(null);
  const [ask, setAsk] = useState('');
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [filters, setFilters] = useState({ state: 'ALL', reason: 'ALL', priority: 'ALL', sort: 'impact' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [imports, setImports] = useState<string[]>([]);
  const [demoSelectorOpen, setDemoSelectorOpen] = useState(false);
  const demoScenarios = [
    { name: 'Clean Reconciliation', desc: 'Evidence aligns across all three sources.' },
    { name: 'Amount Mismatch', desc: 'A settlement exists, but the amount conflicts.' },
    { name: 'Mixed Investigation', desc: 'A realistic batch with multiple discrepancy types.' },
  ];

  async function execute(importIds: string[]) {
    setBusy(true); setError(''); setProof(null); setAnswer(null);
    try {
      const result = await api.run(importIds);
      const [runCases, runVariance] = await Promise.all([api.cases(result.runId), api.variance(result.runId)]);
      setRun({ ...result, variance: runVariance });
      setCases(result.cases ?? runCases.data);
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Reconciliation failed'); }
    finally { setBusy(false); }
  }

  async function demo(scenario: string) {
    setDemoSelectorOpen(false); setBusy(true); setError('');
    try {
      const data = await api.demo(scenario);
      setImports(data.importIds);
      await execute(data.importIds);
    } catch (e) { setError(e instanceof Error ? e.message : 'Backend unavailable'); setBusy(false); }
  }

  async function upload(file: File, sourceType: 'merchant' | 'psp' | 'bank') {
    setBusy(true); setError('');
    try {
      const content = await file.text();
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
      const checksum = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
      const response = await api.importCsv({ provider: 'razorpay', sourceType, filename: file.name, checksum, fileSizeBytes: file.size, content });
      setImports((current) => [...current.filter((id) => id !== response.id), response.id]);
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Import failed'); }
    finally { setBusy(false); }
  }

  async function inspect(id: string) {
    if (!run) return;
    try { setProof(await api.proofForRun(run.runId, id)); document.querySelector('#proof')?.scrollIntoView({ behavior: 'smooth' }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Proof unavailable'); }
  }

  async function askAnvaya() {
    if (!run || !ask.trim()) return;
    setBusy(true); setError('');
    try { setAnswer(await api.ask(run.runId, ask.trim())); }
    catch (e) { setError(e instanceof Error ? e.message : 'Ask Anvaya unavailable'); }
    finally { setBusy(false); }
  }

  const m = run?.metrics;
  const variance = run?.variance;
  const proofEvidence = (proof?.evidence && typeof proof.evidence === 'object' ? proof.evidence : proof) as Record<string, unknown> | undefined;
  const visibleCases = useMemo(() => cases.filter((item) => (filters.state === 'ALL' || item.state === filters.state) && (filters.reason === 'ALL' || item.reason === filters.reason) && (filters.priority === 'ALL' || item.priority === filters.priority)).sort((a, b) => filters.sort === 'priority' ? a.priority.localeCompare(b.priority) : b.amountMinor - a.amountMinor), [cases, filters]);
  const reasons = Array.from(new Set(cases.map((item) => item.reason).filter((reason): reason is string => Boolean(reason))));

  return <main>
    <header><div className="brand"><AnvayaMark /><span>ANVAYA</span></div><nav><a href="#control">Control Room</a><a href="#money">Money Explanation</a><a href="#exceptions">Exceptions</a><a href="#ask">Ask Anvaya</a></nav><div className="actions">
      <div className="demo-selector" style={{ position: 'relative' }}>
        <button className="secondary" onClick={() => setDemoSelectorOpen(!demoSelectorOpen)} disabled={busy}><Icon name="pulse" />Use Demo Dataset</button>
        {demoSelectorOpen && <div className="dropdown" style={{ position: 'absolute', top: '100%', right: 0, background: '#1c1c18', border: '1px solid #45423a', borderRadius: '4px', padding: '6px', zIndex: 10, minWidth: '210px', display: 'flex', flexDirection: 'column', gap: '2px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          <p style={{ margin: '4px 8px 8px', fontSize: '10px', color: '#7a7770', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Select scenario</p>
          {demoScenarios.map(s => <button key={s.name} onClick={() => void demo(s.name)} style={{ background: 'transparent', border: 'none', color: '#eee9dc', textAlign: 'left', padding: '8px 10px', cursor: 'pointer', borderRadius: '3px', fontSize: '13px' }} onMouseEnter={e => { e.currentTarget.style.background = '#2a2a24'; e.currentTarget.style.color = '#c5a35a'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#eee9dc'; }}><span>{s.name}</span><br /><small style={{ fontSize: '10px', color: '#7a7770' }}>{s.desc}</small></button>)}
        </div>}
      </div>
      <button className="primary" onClick={() => void execute(imports)} disabled={busy || imports.length !== 3}>Run Reconciliation</button>
    </div></header>
    {error && <div className="error">{error}</div>}
    <section className="section imports"><div className="section-head"><p className="kicker">00 / SOURCE IMPORTS</p><h2>Load the evidence set</h2></div><div className="upload-grid">{(['merchant', 'psp', 'bank'] as const).map((source, index) => <label className="upload-card" key={source}><span>{source === 'merchant' ? 'Merchant Transactions' : source === 'psp' ? 'Settlement Report' : 'Bank Statement'}</span><small>{imports[index] ? 'Imported' : 'CSV required'}</small><input type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file, source); }} /></label>)}</div></section>
    <section className="hero"><div><p className="kicker">FINANCIAL OPERATIONS / EVIDENCE PLATFORM</p><h1>Know where every<br /><em>rupee</em> reconciles.</h1><p className="lede">Anvaya connects merchant transactions, PSP settlement and bank cash - investigating ambiguity without compromising deterministic truth.</p></div><div className="runbox"><span>RECONCILIATION RUN</span><strong>{run ? 'CURRENT RUN' : '-'}</strong><small>{run ? `${run.status.toUpperCase()} \u00b7 ${new Date(run.asOf).toLocaleString()}` : 'Ready for source imports'}</small>{run && <small style={{ fontSize: '9px', color: '#5a5850', fontFamily: 'monospace' }}>{run.runId}</small>}</div></section>
    <section id="control" className="section"><div className="section-head"><p className="kicker">01 / CONTROL ROOM</p><h2>Operational signal</h2></div>{m ? <div className="metrics">{[['TOTAL PROCESSED', m.batchRecordCount?.toLocaleString('en-IN'), 'records'], ['MATCH RATE', percent(m.matchRateTransactionSettlement), 'txn to settlement'], ['VERIFIED VALUE', money(m.verifiedValueMinor), 'financial value passing validation'], ['PENDING', money(m.pendingValueMinor), 'timing / review'], ['UNRESOLVED', money(m.unresolvedValueMinor), 'evidence required'], ['EXCEPTIONS', String(m.caseCount ?? cases.length), 'current run'], ['LLM USAGE', `${m.llmCallsUsed ?? 0} / ${m.llmCallBudget ?? 0}`, m.llmProvider === 'mock-provider' ? 'mock investigation' : 'Gemini inference'], ['THROUGHPUT', `${(m.throughputPerHour ?? 0).toLocaleString('en-IN')} / hr`, 'records per hour']].map(([label, value, detail], index) => <article className={`metric ${index < 5 ? 'metric-primary' : ''}`} key={label as string}><span>{label}</span><b>{value}</b><small>{detail}</small></article>)}</div> : <div className="empty">No active run. Use Demo Dataset to begin an evidence-backed reconciliation.</div>}</section>
    <section id="money" className="section"><div className="section-head"><p className="kicker">02 / MONEY EXPLANATION</p><h2>Follow the value</h2></div><div className="flow">{[['Gross source value', m?.grossSourceValueMinor], ['PSP settlement', m?.pspSettlementValueMinor], ['Bank cash', m?.bankCashValueMinor], ['Explained variance', m?.explainedVarianceMinor], ['Unresolved value', m?.unresolvedValueMinor]].map(([label, value], i) => <div className="flow-item" key={label as string}><span>0{i + 1}</span><strong>{label}</strong><b>{money(value as number | undefined)}</b></div>)}</div><div className="legend"><span className="verified" title="Required evidence and validation checks passed.">VERIFIED</span><span className="explained" title="Variance driver identified.">EXPLAINED</span><span className="pending" title="Required evidence or timing conditions are not yet complete.">PENDING</span><span className="unresolved" title="Variance is unexplained.">UNRESOLVED</span><span className="escalated" title="Escalated for human review - evidence was insufficient to safely verify this relationship.">ESCALATED</span></div>{variance && <div className="variance"><div className="variance-summary"><div><span className="eyebrow">UNRESOLVED AMOUNT</span><strong>{money(variance.unresolvedAmountMinor)}</strong></div><div><span className="eyebrow">PRIMARY DRIVER</span><strong className={getDriverClass(variance.primaryReason)}>{title(variance.primaryReason) || 'Unavailable'}</strong></div><p>{variance.operationalExplanation}</p></div><div className="variance-grid"><div><span className="eyebrow">EVIDENCE FOUND</span><p>{variance.evidenceFound?.length ? variance.evidenceFound.join(' \u00b7 ') : 'None recorded'}</p></div><div><span className="eyebrow">EVIDENCE REQUIRED</span><p>{variance.requiredNextEvidence?.length ? variance.requiredNextEvidence.join(' \u00b7 ') : 'None recorded'}</p></div></div><div className="drivers">{variance.drivers?.map((driver) => <div className="driver" key={driver.reason}><span>{title(driver.reason)}</span><b className={getDriverClass(driver.reason)}>{money(driver.amountMinor)}</b><small>{driver.caseCount} cases \u00b7 {driver.relationshipCount} relationships</small></div>)}</div></div>}</section>
    <section className="section"><div className="section-head"><p className="kicker">03 / RECONCILIATION FLOW</p><h2>Investigation is bounded. Truth is deterministic.</h2></div><div className="pipeline">{['Merchant', 'PSP Settlement', 'Bank', 'Reconciled', 'Validated'].map((x, i) => <div className={`pipeline-step${i < 4 ? ' has-arrow' : ''}`} key={x}><span className="node">{String(i + 1).padStart(2, '0')}</span><strong>{x}</strong></div>)}</div></section>
    <section id="exceptions" className="section"><div className="section-head"><p className="kicker">04 / EXCEPTION QUEUE</p><h2>Cases requiring attention <span>{cases.length}</span></h2></div><div className="filters"><select value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })}><option>ALL</option>{['PENDING', 'ESCALATED', 'VERIFIED'].map((x) => <option key={x}>{x}</option>)}</select><select value={filters.reason} onChange={(e) => setFilters({ ...filters, reason: e.target.value })}><option>ALL</option>{reasons.map((x) => <option key={x}>{x}</option>)}</select><select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}><option>ALL</option>{['HIGH', 'MEDIUM', 'LOW'].map((x) => <option key={x}>{x}</option>)}</select><select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}><option value="impact">SORT: FINANCIAL IMPACT</option><option value="priority">SORT: PRIORITY</option></select></div>{visibleCases.length ? <div className="case-list">{visibleCases.map((c) => <button className="case" key={c.id} onClick={() => void inspect(c.id)}><span className="case-id">{c.id}</span><strong>{title(c.reason)}</strong><span>{money(c.amountMinor)}</span><span className={`priority ${c.priority.toLowerCase()}`}>{c.priority}</span><small className={c.state.toLowerCase()}>{c.state}</small><small>{c.evidenceFound?.length ? 'Evidence found' : 'Evidence missing'}{c.agentInvolvement ? ' \u00b7 AI trace' : ''}</small></button>)}</div> : <div className="empty">No exceptions match the current filters.</div>}</section>
    <section id="proof" className="section proof"><div className="section-head"><p className="kicker">05 / PROOF</p><h2>Evidence ledger</h2></div>{proof ? <div className="proof-viewer">{[['WHY THIS CASE EXISTS', String(proof.reason ?? proof.machineReason ?? 'Unavailable')], ['EVIDENCE FOUND', Array.isArray(proofEvidence?.evidenceFound) ? (proofEvidence.evidenceFound as string[]).join(' \u00b7 ') : 'None recorded'], ['EVIDENCE MISSING', Array.isArray(proofEvidence?.evidenceMissing) ? (proofEvidence.evidenceMissing as string[]).join(' \u00b7 ') : 'None recorded'], ['CHECKS PERFORMED', 'Identity \u00b7 amount \u00b7 timing \u00b7 provenance'], ['AI INVESTIGATION', Array.isArray(proof.actionTrace) ? `${proof.actionTrace.length} bounded action(s) recorded` : Array.isArray(proof.agentActions) ? `${proof.agentActions.length} bounded action(s) recorded` : 'No AI investigation required'], ['DETERMINISTIC VALIDATION', 'Validation gate remains the sole VERIFIED authority'], ['FINAL DECISION', String(proof.finalState ?? proof.machineState ?? 'Unavailable')], ['REQUIRED NEXT STEP', Array.isArray(proofEvidence?.evidenceMissing) && proofEvidence.evidenceMissing.length ? (proofEvidence.evidenceMissing as string[]).join(' \u00b7 ') : 'No further evidence recorded']].map(([label, value], index) => <div className={`proof-panel ${label === 'AI INVESTIGATION' ? 'ai-panel' : ''}`} key={label}><span className="eyebrow">{String(index + 1).padStart(2, '0')} / {label}</span><p>{value}</p></div>)}<p className="authority">AI INVESTIGATES. DETERMINISTIC CONTROLS DECIDE.</p></div> : <div className="empty">Select an exception to reconstruct its persisted proof, validation checks and agent trace.</div>}</section>
    <section id="ask" className="section ask"><div className="section-head"><p className="kicker">06 / ASK ANVAYA</p><h2>Ask a grounded question</h2></div><div className="ask-box"><div className="ask-input"><Icon name="search" /><input value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void askAnvaya(); }} placeholder={run ? 'e.g. Which transaction has the largest unresolved amount?' : 'Load a reconciliation run to ask a question'} disabled={!run || busy} /><button className="primary" onClick={() => void askAnvaya()} disabled={!run || busy || !ask.trim()}>Ask</button></div><div className="suggestions">{['How much remains unresolved?', 'How many cases were escalated?', 'Which transaction has the largest unresolved amount?', 'What evidence is missing?', 'Show me all pending cases.'].map((question) => <button key={question} onClick={() => { setAsk(question); }}>{question}</button>)}</div>{answer && <div className="answer"><span className="eyebrow">{answer.unavailable || !answer.answer ? 'UNAVAILABLE' : 'GROUNDED IN CURRENT RUN'}</span><p>{answer.answer}</p>{answer.citations?.length ? <small>Evidence: {answer.citations.join(' \u00b7 ')}</small> : null}</div>}</div></section>
    <footer><div className="brand"><AnvayaMark /><span>ANVAYA</span></div><span>AI investigates. Deterministic logic decides.</span></footer>
  </main>;
}
