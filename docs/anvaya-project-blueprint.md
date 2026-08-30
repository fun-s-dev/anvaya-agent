# Anvaya — Final Project Blueprint

> Razorpay AI Buildathon • Track 04 — AI Finance Controller

## 1. Final Design Decision

Anvaya is a provider-agnostic reconciliation and discrepancy-investigation controller for payment/settlement finance operations.

The system uses an **LLM agent as the investigation controller**, but the LLM is never the financial authority. The agent chooses the next bounded tool/action. Deterministic tools perform matching, allocation, arithmetic and policy checks. A deterministic validation gate decides whether a candidate can become a verified financial relationship.

Razorpay is the first concrete provider adapter because this is the Razorpay buildathon. The canonical model and reconciliation engine must remain provider-neutral.

**AI/data boundary:** use synthetic data for the public hackathon demo. Minimize model input to the evidence required for the current case. No external model may directly modify financial state, move money, or bypass validation.

## 2. Track 04 Interpretation

| PS requirement | Implementation |
|---|---|
| Build an agent | LLM controller with bounded tools and an explicit observe → choose → execute → observe loop |
| Close one finance-ops loop | Merchant payment → PSP settlement → bank cash reconciliation |
| 50+ record synthetic batch | Seeded scenario generator, normally 100–500 records |
| Report match rate | Relationship-specific match rates with explicit numerator/denominator |
| Report exceptions | Pending and escalated cases remain visible |
| Verification-first | AI investigates/proposes; deterministic controls verify |
| Throughput + measured accuracy + honest exceptions | Whole-batch evaluation, hidden truth, multiple seeds |

## 3. Real-World Problem

A payment-related financial event is represented in multiple systems:

- **Merchant system:** order/payment reference, gross amount, business status.
- **PSP / gateway:** payment/refund/adjustment records, settlement IDs, fees/tax metadata and settlement references.
- **Bank:** posted cash movement, date, bank reference and narration.

The engine must therefore reconcile **relationships**, not row positions. It must support different identifiers, formatting, timestamps and aggregation levels.

## 4. Core Product

**Product statement:**

> A provider-agnostic reconciliation and discrepancy-investigation controller that reconstructs payment-to-settlement-to-bank relationships, verifies financial consistency, and turns unresolved variance into an evidence-backed human review queue.

The product is not a replacement for a PSP dashboard, a complete ERP, a fraud detector, or a generic document chatbot.

## 5. Final Architecture

```text
Merchant CSV ─┐
PSP CSV      ├→ Secure ingestion + lineage + schema validation
Bank CSV     ┘
                     ↓
            Provider adapters
                     ↓
           Canonical financial model
                     ↓
        Mandatory deterministic integrity
        + deterministic reconciliation
                     ↓
            ┌── clean case ──→ VERIFIED
            │
            └── ambiguous case
                     ↓
                 LLM AGENT
          observe → choose action
                     ↓
             bounded deterministic tool
                     ↓
                observe result
                     ↓
             validation / policy gate
                     ↓
             VERIFIED / PENDING / ESCALATED
```

### Authority boundaries

| Component | Responsibility | Financial authority |
|---|---|---|
| Source adapter | Map external fields to canonical concepts | No |
| Ingestion/security | Validate file, checksum, type/size, import identity, lineage | No |
| Canonical model | Store normalized state and relationships | No external truth authority |
| Deterministic tools | Search, match, allocate, calculate, timing checks | Yes for calculations |
| LLM agent | Choose bounded investigation actions; interpret ambiguous evidence | No direct financial write authority |
| Validation gate | Identity, amount, date, uniqueness, allocation, conservation | Sole gate to VERIFIED |
| Evidence ledger | Store evidence, calculations, action history | Audit/replay support |
| Case queue | Expose pending/escalated work | Human operational interface |

## 6. Agent Design

### 6.1 Agent states

```text
OPEN
INVESTIGATING
PENDING
RESOLVED
ESCALATED
```

Reason codes:

```text
AMOUNT_MISMATCH
MISSING_SETTLEMENT
MISSING_BANK_CREDIT
TIMING_DELAY
AMBIGUOUS_REFERENCE
CONFLICTING_EVIDENCE
INTEGRITY_FAILURE
UNATTRIBUTED_BANK_ENTRY
```

Agent actions:

```text
RUN_INTEGRITY_CHECK
MATCH_EXACT
MATCH_COMPOSITE
MATCH_AGGREGATE
CHECK_TIMING
CALCULATE_VARIANCE
INTERPRET_EVIDENCE
VALIDATE_CANDIDATE
ESCALATE
```

### 6.2 Why it is an agent

The agent observes current case state, chooses from admissible actions, executes a bounded tool, observes the result, and can continue, resolve, wait or escalate. Every action is recorded.

### 6.3 Tool-use boundary

- The application computes the **available action set**; the LLM can only choose from it.
- A schema-valid action is not automatically policy-valid.
- The backend checks semantic preconditions before execution.
- The LLM cannot directly write financial state.

## 7. Agent Guardrails

### Per-case

- `MAX_ACTIONS_PER_CASE = 6`.
- Action **#6 is reserved for `ESCALATE`**.
- `MAX_LLM_CALLS_PER_CASE = 2`.
- Counters are scoped to a single reconciliation run, not case lifetime.

The controller must check the budget **before** each action:

```ts
if (actionCount >= 5 && !isTerminal(state)) {
  return ESCALATE; // action #6
}
```

### Run-level

```text
max_llm_calls_per_run = min(20, max(5, ceil(0.10 × batch_record_count)))
```

When the run-level LLM budget is exhausted, LLM-dependent actions are disabled; cases continue through deterministic actions where possible or are explicitly escalated.

### LLM failure handling

- Short request timeout.
- At most one bounded retry.
- Invalid structured output, timeout, rate limit or provider error is recorded as an AI infrastructure failure.
- A model failure disables further model calls **for the current case** by default; it must not fail open.
- The case continues deterministically where possible or escalates with an explicit reason.

## 8. Mandatory Settlement Integrity Check

This runs **before any transaction-side or bank-side matching and before any LLM call**.

For every settlement:

1. Verify required fields and source identity.
2. Verify settlement component identity and lineage.
3. Validate money semantics.
4. Compute the component financial effect.
5. Compare `SUM(component financial effect)` with `stated_amount_minor` when the provider adapter declares the component set complete.
6. If inconsistent, mark `INTEGRITY_FAILURE` and block downstream closure.

`RUN_INTEGRITY_CHECK` remains an agent action only for **re-verification** after later evidence changes the settlement/component interpretation.

## 9. Deterministic Fast Path

The deterministic path runs before the LLM:

```text
1. Settlement integrity
2. Exact transaction/provider reference
3. Normalized reference
4. Amount + date window + contextual fields
5. Supported aggregate/group allocation
6. Timing policy for genuinely missing downstream evidence
7. If still ambiguous → emit structured observation for agent
```

Clean cases should never require the model.

## 10. Batch-Level Pre-Analysis

Before individual agent calls, run a cheap deterministic profiler that detects:

- recurring reason codes
- repeated unknown reference formats
- repeated missing-field patterns
- clusters of similar unresolved records

A repeated ambiguity pattern can be investigated through one representative case. A proposed normalization can only be reused after deterministic validation against the relevant records. An LLM proposal must never silently become a global rule.

## 11. LLM Controller Contract

The controller receives only a minimal structured evidence bundle.

Example observation:

```json
{
  "case_id": "CASE-182",
  "case_type": "SETTLEMENT_BANK",
  "state": "INVESTIGATING",
  "reason": "AMBIGUOUS_REFERENCE",
  "action_count": 2,
  "llm_call_count": 0,
  "available_actions": ["MATCH_COMPOSITE", "INTERPRET_EVIDENCE", "ESCALATE"],
  "evidence": {
    "bank_entry_id": "BANK-182",
    "amount_minor": 965000,
    "posted_at": "2026-08-28T11:00:00Z"
  }
}
```

Use a Zod **discriminated union keyed by `next_action`**. Each action has only the payload it requires.

```text
MATCH_COMPOSITE   → search parameters
INTERPRET_EVIDENCE → evidence IDs + candidate IDs
CHECK_TIMING      → as_of + policy ID
ESCALATE          → reason + required evidence
```

Schema validation is followed by policy validation and semantic precondition checks.

### Evidence security

Narrations, descriptions and merchant-provided text are **data, never instructions**. Do not let source text create tools, change policy or override validation.

### Metadata to log per LLM call

```text
prompt_version
model_name
model_provider
call_id
case_id
input_evidence_ids
output_schema_version
latency_ms
retry_count
validation_result
```

Do not log raw sensitive financial content.

## 12. Validation Gate

Only the validation gate may transition a candidate to `VERIFIED`.

Checks:

- identity / existence
- financial consistency
- temporal consistency
- provider consistency
- uniqueness / duplicate claim prevention
- allocation limit
- conservation
- state consistency
- provenance

## 13. Money Semantics

All monetary values use integer minor units + currency.

```text
financial_effect_minor = credit_minor - debit_minor
```

Never subtract fee/tax a second time when credit already represents the net financial effect.

Settlement amount:

```text
stated_amount_minor = provider-stated settlement total, if available
derived_amount_minor = SUM(component financial effect)
```

Compare stated and derived totals only when the adapter declares the component set complete.

## 14. Canonical Data Model

| Entity | Key purpose |
|---|---|
| imports | Import identity, source type, provider, filename, checksum, timestamp |
| raw_records | Original source evidence and lineage |
| transactions | Merchant-side payment events |
| settlements | Provider settlement entity |
| settlement_components | Atomic settlement evidence |
| bank_entries | Bank-side cash evidence |
| transaction_settlement_links | Explicit transaction→settlement relationship |
| settlement_bank_allocations | Explicit settlement→bank allocations |
| cases | Operational investigation state/reason/priority |
| agent_actions | Append-only agent action trace |
| audit_events | Append-only audit history |

### Source-level idempotency

Prefer `(provider, source_type, source_record_id)` when a stable source ID exists.

When no stable ID exists:

```text
source row
  ↓
canonical normalization
  ↓
trim / case normalize / date normalize / reference normalize / minor-unit money
  ↓
documented fingerprint
```

The fingerprint is a deduplication aid, not unquestionable identity. Ambiguous collisions become import exceptions.

## 15. Transaction → Settlement

Supported matching priority:

1. Exact reference.
2. Normalized reference.
3. Amount + date + contextual fields.
4. Supported aggregate/group allocation.
5. Agent investigation for genuine ambiguity.
6. Escalation when no defensible relationship exists.

The engine supports many→one transaction/settlement allocation and does not rely on row order.

## 16. Settlement → Bank

Priority:

1. Settlement/bank trace reference + compatible amount/date.
2. Normalized bank reference.
3. Amount + date + unique contextual evidence.
4. Explicit one-settlement→multiple-bank-entry allocation.
5. Pending/escalation when evidence is missing/conflicting.

An unattributed bank entry is not automatically fraud.

## 17. Timing and Pending

Each run has an explicit `as_of` timestamp and configurable timing policy.

```text
not yet due → PENDING
overdue / evidence absent → INVESTIGATE or ESCALATE
```

Circuit-breaker counters reset for a later run. A legitimate PENDING case therefore receives a fresh action budget on a later reconciliation run.

## 18. M:N Scope

The schema can represent M:N through allocation rows, but the reference engine does **not** claim arbitrary combinatorial M:N solving.

Hackathon scope: support 1:1, N:1 and 1:N. Escalate ambiguous M:N patterns.

Future production scope may add constrained bipartite assignment only when business rules define valid allocations.

## 19. Batch Control Metrics

| Metric | Meaning |
|---|---|
| Match rate — transaction→settlement | Correctly resolved evaluable relationships / evaluable relationships |
| Match rate — settlement→bank | Correctly resolved evaluable relationships / evaluable relationships |
| Verified value | Financial value supported by validated evidence |
| Pending value | Financial value whose evidence is not yet due |
| Explained variance | Known and evidenced financial difference |
| Unexplained value | Remaining unsupported difference |
| Unattributed bank value | Bank cash outside modeled relationships |
| Human-review value | Value represented by escalated cases |
| False-resolution rate | Incorrectly closed cases / all closed cases |
| Throughput | Records processed per unit time |

## 20. Evaluation

Use hidden ground truth generated from the same scenario but inaccessible to operational reconciliation code.

Evaluate with 3–5 seeds and include a failure-heavy seed.

With an LLM, separate reproducibility into:

- **Must be stable:** final validated state, financial amount, accepted relationships/evidence, false-resolution rate.
- **May vary:** exact agent action path and natural-language explanation wording.

Optional secondary metric: action-path consistency.

## 21. Synthetic Data Generator

The generator is a **factory for synthetic financial worlds**, not a random CSV faker.

```text
Scenario
  ↓
Merchant records
PSP records/components
Settlement
Bank entries
  ↓
Controlled mutation
  ↓
CSV views + hidden ground truth
```

Required mutations:

```text
wrong_amount()
missing_settlement()
reference_truncation()
reference_prefix_change()
ambiguous_reference()
conflicting_candidate_set()
bank_timing_delay()
unattributed_bank_entry()
duplicate_import()
unsupported_adjustment_reference()
settlement_component_integrity_break()
```

Same seed + same configuration must reproduce equivalent data and hidden truth.

Recommended command:

```bash
npm run generate -- --seed 42 --size 100
```

## 22. CSV Demo Flow

For the public demo, the frontend can trigger scenario generation through the backend:

```text
Judge clicks: Use Demo Dataset
        ↓
POST /demo/generate
        ↓
Scenario generator
        ↓
merchant_transactions.csv
settlement_records.csv
bank_statement.csv
        ↓
import service / canonical DB
        ↓
reconciliation
```

For maximum demo reliability, use a fixed seeded demo dataset during the main walkthrough and show fresh-seed generation as a secondary technical proof.

## 23. Security and Privacy

Public demo uses synthetic data only.

Controls:

- strict upload validation
- file-size limits
- generated private filenames
- no public source-file URLs
- no raw financial data in normal logs
- no secrets in Git
- authentication/authorization for non-demo deployments
- explicit retention/deletion policy
- minimal case-specific evidence to external LLM
- no money-moving tools
- prompt-injection defense by treating evidence text as untrusted data

## 24. Technical Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js + React + TypeScript + Tailwind |
| Backend | Node.js + TypeScript + Fastify |
| Database | PostgreSQL |
| ORM | Prisma |
| Contracts | Zod |
| CSV | PapaParse / equivalent |
| LLM | Provider behind an interface; Gemini free tier may be used with synthetic data |
| Tests | Vitest + Fastify inject |
| Charts | Recharts |
| Deployment | Next.js host + Node backend + managed PostgreSQL |
| Queue | None initially; background worker only if deployment request limits require it |
| Kafka | Production option only for justified async ingestion/replay |
| Vector DB | None |
| ML training | None |

## 25. API Surface

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /imports | Register/upload a source CSV |
| GET | /imports/:id | Import status |
| POST | /reconciliation/runs | Create/start reconciliation run with idempotency key |
| GET | /reconciliation/runs/:id | Run status + metrics |
| GET | /cases | Filter cases |
| GET | /cases/:id | Evidence, actions, calculations, validation |
| POST | /cases/:id/retry | Retry admissible investigation |
| POST | /cases/:id/resolve | Human resolution + audit event |
| GET | /metrics?runId= | Metrics |
| GET | /audit/:entityId | Audit history |
| GET | /sources/:id | Source lineage |
| POST | /agent/step | Optional internal single-step controller endpoint |

The frontend must never directly mutate financial database tables.

## 26. UX / Judge Demo

Main screens:

1. Import — Merchant Transactions / Settlement Report / Bank Statement.
2. Control Room — match rates, verified/pending/unresolved value, human-review rate, throughput, LLM calls.
3. Money Explanation — gross, settlement, deductions, bank cash, explained/unexplained variance.
4. Exception Queue — priority, rupee impact, state, reason, evidence found, evidence required.
5. Case Detail / Proof — agent trace, candidate, tool results, validation checks, source lineage.

Judge walkthrough:

```text
Use Demo Dataset
→ Run full batch
→ show literal Match rate
→ show verified/pending/unresolved value
→ open high-value exception
→ show agent actions
→ show LLM only on ambiguous case
→ show validator reject an unsupported AI proposal
→ show evidence required for escalation
```

## 27. Competitive Positioning

Do not claim reconciliation or AI reconciliation is a new category.

The differentiated claim is:

> **Evidence-backed discrepancy investigation with explicit resolution requirements and deterministic financial authority.**

Supporting differentiators:

- provider-agnostic canonical core
- targeted AI investigation rather than AI-everywhere
- explicit uncertainty
- source/evidence lineage
- deterministic financial-impact prioritization
- measurable reduction in human investigation workload

## 28. Production Evolution

```text
Merchant / ERP ─┐
PSP events     ├→ source adapters → canonical event/data layer → reconciliation controller
Bank feeds     ┘                                  ↓
                                             cases + evidence
                                                  ↓
                                      VERIFIED / PENDING / ESCALATED
```

Production additions may include authenticated adapters, scheduled/incremental runs, RBAC, maker-checker, encrypted storage, and an event broker when asynchronous ingestion/replay justifies it.

## 29. Repository Structure

```text
/apps
  /web
  /api

/packages
  /contracts
  /canonical
  /reconciliation
  /agent
  /adapters
    /razorpay
    /mock-provider
  /generator
  /evaluator
  /security

/data
  /demo

/docs
  project-blueprint.md
  evaluation.md
  demo.md
```

Dependency rule:

```text
web → contracts
api → contracts + domain
agent → domain + tools
adapters → canonical/domain
canonical/reconciliation → MUST NOT import provider-specific adapters
```

## 30. GitHub Build Plan

### 30.1 Part 1 — Foundation + Canonical Model
**Commit:** `feat(core): foundation and canonical data boundary`

Monorepo, TypeScript, Next.js, Fastify, PostgreSQL, Prisma, Zod, canonical schema, imports, raw lineage, stable-ID uniqueness, API skeleton.

### 30.2 Part 2 — Synthetic World + Hidden Truth
**Commit:** `feat(data): scenario generator and hidden truth`

Scenario-first generator, mutations, seeds, 50/100/500 sizes, hidden truth isolation, demo fixtures.

### 30.3 Part 3 — Deterministic Reconciliation
**Commit:** `feat(recon): deterministic financial engine`

Mandatory settlement integrity check, exact/normalized/composite matching, allocation, timing, money semantics, invariants.

### 30.4 Part 4 — Agent Controller + LLM Tool Use
**Commit:** `feat(agent): bounded LLM reconciliation controller`

LLM interface, deterministic pre-filter, action registry, discriminated union, policy validation, circuit breakers, model-failure handling.

### 30.5 Part 5 — Validation + Evidence Ledger
**Commit:** `feat(control): validation and evidence ledger`

Validation gate, DB-protected allocations, evidence lineage, audit/action ledger, proof data, human resolution.

### 30.6 Part 6 — Evaluation + Metrics
**Commit:** `feat(eval): full-batch evaluation`

Hidden-truth evaluator, multi-seed metrics, false-resolution rate, match rates, unresolved value, throughput.

### 30.7 Part 7 — Product UI + Deployment
**Commit:** `feat(product): finance control room and deployment`

Import UI, control room, exceptions, proof view, secure uploads, demo generation, deployment.

### 30.8 Part 8 — Optional Extensions
**Commit:** `feat(optional): post-core extensions`

Second mock provider, PDF ingestion, variance intelligence, verified-data Q&A, constrained M:N, justified event ingestion.

Each part must leave the repository runnable, tested, committed and pushable.

## 31. Git / Agent Working Rules

- Inspect `git status` before changing anything.
- Do not overwrite unrelated work.
- Work on a feature branch for each part.
- Run formatting, linting, typecheck and relevant tests before declaring completion.
- Never commit secrets, `.env`, `node_modules`, build artifacts or private generated data.
- Use focused conventional commits.
- Push only when remote credentials are configured and push is authorized.
- Report files changed, tests run, commit hash, branch and push status after each part.

## 32. Final Architecture Freeze

| Decision | Final |
|---|---|
| Agent | LLM controller for bounded investigation |
| Financial authority | Deterministic calculations + validation |
| Initial integrity | Mandatory and automatic before matching/LLM |
| AI invocation | Only after deterministic pre-filter |
| Case action budget | 6, with action #6 = ESCALATE |
| LLM budget | 2/case + run-level cap |
| Case counter scope | Per reconciliation run |
| Matching | Provider-neutral; no row-order assumption |
| M:N | Representable, not arbitrarily solved in reference engine |
| Input | CSV MVP |
| Provider | Razorpay first adapter; generic core |
| Security | Synthetic public data + minimal LLM evidence |
| Queue | None initially; worker only if deployment limits require |
| Kafka | Future production option only |

## 33. Final One-Sentence Pitch

> **Anvaya is an AI finance controller that investigates payment-settlement discrepancies across merchant, PSP and bank records; the agent decides what to check next, while deterministic financial controls decide what can actually be trusted.**
