# Anvaya

Anvaya is a provider-agnostic payment reconciliation and discrepancy-investigation controller.

Its core flow is:

`Merchant transactions -> PSP settlement -> Bank cash -> deterministic reconciliation -> bounded investigation for ambiguity -> deterministic validation`

**AI investigates. Deterministic controls decide.**

## The problem

The same financial event appears in three operational records: the merchant transaction, the PSP settlement, and the bank statement. Anvaya connects those records, preserves their evidence, and identifies:

- exact matches
- amount mismatches
- missing or unattributed bank evidence
- unresolved discrepancies
- cases requiring investigation

## Current features

- Strict CSV schema validation
- Merchant transaction ingestion
- PSP settlement ingestion
- Bank statement ingestion
- Razorpay adapter
- Canonical financial model
- Deterministic reconciliation
- Transaction-to-settlement matching
- Settlement-to-bank matching
- Amount mismatch detection
- Evidence-backed exception handling
- `VERIFIED`, `PENDING`, and `ESCALATED` states
- Money Explanation
- Bounded agent investigation
- Optional Gemini integration
- Grounded Ask Anvaya
- Three synthetic demo scenarios
- Current-run privacy model
- No user-facing Run History

## Demo scenarios

### Clean Reconciliation

Evidence aligns across the three sources. Demonstrates deterministic verification.

### Amount Mismatch

A transaction and PSP settlement relationship exists, but the amounts differ.

### Mixed Investigation

A synthetic run containing multiple discrepancy types requiring investigation.

## AI and Gemini

Gemini is bounded to the investigation boundary. It may:

- interpret ambiguous investigation context
- structure natural-language intent
- assist investigation

Gemini may not:

- directly modify financial state
- declare financial truth
- bypass validation
- invent evidence

Deterministic reconciliation and validation remain authoritative. If Gemini is not configured, ambiguous cases use the deterministic fallback provider.

Example backend configuration:

```dotenv
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=your_model_here
```

Never commit a real key. The key is backend-only and is never sent to the frontend.

## Ask Anvaya

Ask Anvaya answers questions grounded in the **current reconciliation run**. Examples include:

- How many cases were escalated?
- Which case has the highest unresolved amount?
- Why was this case escalated?
- What evidence is missing?
- Which settlements have no bank credit?

Unsupported questions are rejected rather than answered from invented context.

## Privacy

The current application has no authentication. Therefore:

- there is no user-facing Run History
- there is no global historical run listing
- no multi-tenant isolation is claimed
- current-run data is the scope of the interface

The checked-in demo inputs are synthetic.

## Local setup

### Prerequisites

- Node.js 20+
- npm
- PostgreSQL

### Install and configure

```powershell
npm install
Copy-Item .env.example .env
```

Set `DATABASE_URL` in `.env` to a PostgreSQL database you can use locally. `PORT` defaults to `4000`, and `NEXT_PUBLIC_API_URL` should remain `http://localhost:4000` for the local frontend. `GEMINI_API_KEY` and `GEMINI_MODEL` are optional.

Generate the Prisma client and apply migrations:

```powershell
npx prisma generate --schema prisma\schema.prisma
npx prisma migrate deploy --schema prisma\schema.prisma
```

For a local demo without PostgreSQL, set `ANVAYA_DEMO_STORE=memory`.

### Start the API

```powershell
npm run dev:api
```

API URL: `http://localhost:4000`

### Start the frontend

In a second terminal:

```powershell
npm run dev:frontend
```

Frontend URL: `http://localhost:3001`

## Demo flow

1. Start the API.
2. Start the frontend.
3. Open `http://localhost:3001`.
4. Click **Use Demo Dataset**.
5. Choose **Clean Reconciliation**.
6. Run reconciliation.
7. Inspect **Control Room**.
8. Open **Money Explanation**.
9. Try **Amount Mismatch**.
10. Try **Mixed Investigation**.
11. Use Ask Anvaya for a grounded question.
12. Inspect the evidence and proof for exceptions.

## Architecture

The authority boundary is:

`Source adapters -> canonical model -> deterministic integrity/reconciliation -> clean fast path -> bounded AI investigation where needed -> deterministic validation -> final state`

The main states are:

- **VERIFIED** - deterministic validation confirmed the relationship.
- **PENDING** - the case remains within a policy or timing window.
- **ESCALATED** - evidence was insufficient for safe automatic verification and requires human review.

AI can investigate ambiguity, but only deterministic controls can validate the final financial state.

## Project structure

```text
apps/api/       Fastify API and reconciliation routes
frontend/       Next.js control-room interface
packages/       Canonical model, contracts, adapters, agent, reconciliation, and tests
prisma/         Prisma schema and migrations
data/demo/      Synthetic merchant, settlement, and bank CSV inputs
scripts/        Repository utilities and demo generation
```

The public demo inputs are:

- `data/demo/merchant_transactions.csv`
- `data/demo/settlement_records.csv`
- `data/demo/bank_statement.csv`

## Testing

Run the repository checks that are configured:

```powershell
npm test
npm run typecheck --workspaces --if-present
npm run lint --workspaces --if-present
npm run build --workspaces --if-present
git diff --check
```
