# Anvaya

An evidence-backed payment reconciliation and discrepancy investigation platform that connects merchant transactions, PSP settlements, and bank cash while keeping financial truth deterministic.

## What is Anvaya?

The same payment appears in several financial systems:

```text
Merchant transaction
        |
        v
PSP settlement
        |
        v
Bank statement
```

These records can arrive at different times, use different references, contain amount differences, appear in aggregate settlements, or lack enough evidence to explain a variance. Anvaya reconstructs the relationships between them and determines what can actually be proven.

> **AI investigates. Deterministic controls decide.**

Anvaya is a controller between raw financial evidence and human review. It preserves source lineage, performs deterministic matching and validation, and sends only genuinely ambiguous cases to bounded investigation.

## The problem

Reconciliation is more than row matching. Financial teams need evidence, not guesses. Unexplained variance requires investigation, while blindly forcing matches creates financial risk. AI-generated conclusions also cannot be treated as financial truth.

Anvaya addresses this by:

- connecting merchant, PSP, and bank records
- identifying exact and supported aggregate relationships
- detecting amount mismatches and missing bank evidence
- making unresolved financial impact explicit
- retaining evidence and validation proof for exceptions
- escalating cases that cannot be safely verified

## How Anvaya works

```text
Merchant Transactions
        |
        v
PSP Settlement
        |
        v
Bank Cash
        |
        v
Canonical Financial Model
        |
        v
Deterministic Reconciliation
        |
        v
Clean Fast Path
        |
        v
Bounded AI Investigation
        |
        v
Deterministic Validation Gate
        |
        v
VERIFIED / PENDING / ESCALATED
```

1. **Source ingestion** validates CSV structure and records provider, source, checksum, and lineage metadata.
2. **Canonical normalization** represents transactions, settlements, settlement components, bank entries, relationships, cases, and proof consistently.
3. **Deterministic reconciliation** matches references and supported relationships, checks amounts and timing, and applies allocation and conservation constraints.
4. **Clean fast path** completes cases that have sufficient deterministic evidence without an AI call.
5. **Bounded investigation** assists only with ambiguous cases under action and call budgets.
6. **Validation** independently checks the candidate relationship and decides the final state.

## Key features

### Evidence ingestion

- Strict CSV schema validation
- Merchant transaction ingestion
- PSP settlement ingestion
- Bank statement ingestion
- Provider and source metadata
- Checksum and idempotency handling
- Razorpay adapter support

### Canonical financial model

Source data is normalized into:

- merchant transactions
- PSP settlements
- settlement components
- bank entries
- deterministic relationships and links
- exception cases
- evidence and proof records

Money is represented in integer minor units rather than floating-point arithmetic.

### Deterministic reconciliation

The reconciliation engine supports:

- exact reference matching
- normalized reference matching
- supported composite and aggregate relationships
- transaction to settlement reconciliation
- settlement to bank reconciliation
- allocation constraints
- conservation checks
- explicit pending and unresolved visibility

### Financial discrepancy detection

Anvaya identifies:

- amount mismatches
- missing bank evidence
- unattributed or excess bank credit
- timing and pending conditions
- unresolved financial impact

### Verification-first state model

| State | Meaning |
| --- | --- |
| `VERIFIED` | Required evidence and deterministic validation checks passed. |
| `PENDING` | Required evidence or timing conditions are not complete. |
| `ESCALATED` | The relationship cannot be safely verified and requires human review. |

### Money Explanation

Money Explanation lets the operator follow the value through the run:

```text
Gross source value
        |
        v
PSP settlement
        |
        v
Bank cash
        |
        v
Explained variance
        |
        v
Unresolved value
```

### Evidence ledger and proof

Exceptions retain:

- evidence found
- evidence missing
- checks performed
- bounded investigation trace
- final decision
- required next step

### Bounded AI investigation

- AI is used only for ambiguous investigation.
- Clean deterministic cases use the fast path.
- The agent operates under action and call budgets.
- Structured outputs are schema validated.
- AI cannot directly modify financial state.
- AI cannot declare a relationship `VERIFIED`.

### Ask Anvaya

Ask Anvaya supports grounded natural-language questions for the current run. Deterministic query handling runs first, and Gemini may help interpret ambiguous language. Answers come from current run data. Unsupported questions are rejected rather than hallucinated.

## Demo scenarios

### Clean Reconciliation

Evidence aligns across merchant, PSP, and bank.

Demonstrates:

- deterministic matching
- validation
- verified financial value
- zero unresolved value

### Amount Mismatch

The merchant transaction and PSP settlement refer to the same relationship, but the amounts differ.

Demonstrates:

- reference-based relationship discovery
- financial variance detection
- unresolved impact
- exception creation
- targeted investigation

### Mixed Investigation

A realistic synthetic dataset containing multiple discrepancy types.

Demonstrates:

- multiple exception classes
- bank-side discrepancies
- investigation
- evidence-backed escalation

## Why the AI boundary matters

### AI does not decide financial truth

Gemini may:

- interpret ambiguous evidence
- structure natural-language intent
- recommend bounded investigation actions

Gemini may not:

- directly write financial state
- bypass deterministic validation
- invent evidence
- declare `VERIFIED`
- overwrite authoritative financial values

The deterministic validation gate is the sole authority for `VERIFIED`. The frontend is a presentation and interaction layer, never the financial source of truth.

## Illustrative investigation example

The following is a conceptual example, not production data:

```text
Merchant amount:  ₹100.00
PSP amount:       ₹98.63
Reference:        same transaction
```

Anvaya:

1. establishes the relationship from the shared reference
2. detects a ₹1.37 variance
3. records `AMOUNT_MISMATCH`
4. keeps the unresolved impact explicit
5. requests supporting evidence
6. does not mark the relationship `VERIFIED`

## Technology stack

| Area | Current technology |
| --- | --- |
| Frontend | Next.js, React, TypeScript |
| Backend | Fastify, TypeScript |
| Data | PostgreSQL, Prisma |
| Validation | Zod |
| Parsing | Current in-repository CSV parser |
| AI | Gemini API through a bounded provider abstraction |
| Testing | Vitest |

## Architecture and authority boundaries

| Layer | Responsibility |
| --- | --- |
| Source adapters | Normalize provider-specific source data. |
| Canonical model | Provide a common financial representation. |
| Reconciliation engine | Perform deterministic matching and allocation. |
| Agent | Investigate and interpret ambiguity within policy limits. |
| Validation gate | Authoritatively decide whether a relationship is `VERIFIED`. |
| Evidence ledger | Preserve proof, checks, evidence, and audit trace. |
| Frontend | Present current-run results and collect operator input. |

The frontend never becomes the financial source of truth. AI can investigate, but deterministic validation decides.

## API overview

Important current routes include:

```text
POST /demo/generate
POST /imports
GET  /imports/:id
POST /reconciliation/runs
GET  /reconciliation/runs/:id
GET  /reconciliation/runs/:id/variance
GET  /cases
GET  /cases/:id
GET  /cases/:id/proof
GET  /runs/:runId/cases
GET  /runs/:runId/cases/:caseId/proof
POST /ask-anvaya
POST /reconciliation/runs/:id/ask
GET  /health
```

There is no global unauthenticated run-history endpoint. The interface is scoped to the current reconciliation run.

## Project structure

```text
frontend/                 Next.js control-room interface
apps/api/                 Fastify API and route handlers
packages/
  adapters/               Provider adapters
  agent/                  Bounded investigation and Gemini provider
  canonical/              Canonical model and validation
  contracts/              Shared schemas and contracts
  evaluator/              Evaluation harness
  generator/              Synthetic scenario generation
  reconciliation/         Deterministic reconciliation engine
  security/               Security utilities
prisma/                   Prisma schema and migrations
data/demo/                Public synthetic CSV inputs
scripts/                  Repository utilities
```

## Local setup

### Prerequisites

- Node.js 20 or newer
- npm
- PostgreSQL

### Install

```powershell
npm install
Copy-Item .env.example .env
```

Set local environment values in `.env`:

```dotenv
DATABASE_URL=your_database_url
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=your_model
```

Never commit real credentials. The Gemini key is backend-only.

Generate the Prisma client and apply migrations:

```powershell
npx prisma generate --schema prisma\schema.prisma
npx prisma migrate deploy --schema prisma\schema.prisma
```

For the explicit local demo memory mode, set:

```dotenv
ANVAYA_DEMO_STORE=memory
```

### Run the API

```powershell
npm run dev:api
```

API: [http://localhost:4000](http://localhost:4000)

### Run the frontend

In a second terminal:

```powershell
npm run dev:frontend
```

Frontend: [http://localhost:3001](http://localhost:3001)

The frontend uses `NEXT_PUBLIC_API_URL=http://localhost:4000`.

## Judge-friendly demo walkthrough

1. Start the API.
2. Start the frontend.
3. Open the frontend at `http://localhost:3001`.
4. Click **Use Demo Dataset**.
5. Run **Clean Reconciliation**.
6. Show **Control Room**, including `VERIFIED VALUE` and `ALL CLEAR`.
7. Switch to **Amount Mismatch**.
8. Show `AMOUNT_MISMATCH` and its unresolved financial impact.
9. Switch to **Mixed Investigation**.
10. Show the exception and variance explanation.
11. Open **Ask Anvaya** and ask a grounded question.
12. Open proof and evidence for an exception.

## Metrics

| Metric | Meaning |
| --- | --- |
| Total Processed | Source records included in the current run. |
| Match Rate | Deterministic relationship match rate for the displayed source pair. |
| Verified Value | Financial value that passed deterministic validation. |
| Pending | Value awaiting evidence or timing completion. |
| Unresolved | Financial impact that remains unexplained or unsafe to verify. |
| Exceptions | Cases requiring attention in the current run. |
| LLM Usage | Actual provider inference calls according to the current implementation. |
| Throughput | Processed records per hour for the run. |

Agent actions are not counted as LLM calls unless they invoke the configured provider.

## Privacy and current product scope

The current demo has no authentication. Therefore:

- there is no user-facing Run History
- there is no global historical run browser
- the current reconciliation run is the main UI scope
- this is a controlled demo application, not a multi-tenant production environment

## Security

- Keep secrets in environment variables.
- Keep the Gemini API key backend-only.
- Hidden evaluation truth is excluded from the public repository.
- Strict input validation rejects malformed source data.
- Deterministic validation prevents AI from becoming the financial authority.

## Public demo data

The repository includes these synthetic public inputs:

- `data/demo/merchant_transactions.csv`
- `data/demo/settlement_records.csv`
- `data/demo/bank_statement.csv`

They contain synthetic demo data only.

## Testing

Run the configured repository checks:

```powershell
npm test
npm run typecheck --workspaces --if-present
npm run lint --workspaces --if-present
npm run build --workspaces --if-present
```

## Limitations and future work

Potential future extensions include:

- additional provider adapters
- PDF ingestion
- richer variance intelligence
- more constrained relationship types
- production authentication and multi-tenancy

These are not presented as implemented features.
