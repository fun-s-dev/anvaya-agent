# Anvaya Agent

Anvaya is a provider-agnostic reconciliation and discrepancy-investigation controller for payment, settlement and bank operations.

## Repository layout

- `apps/web` — Next.js + React + TypeScript frontend
- `apps/api` — Fastify + TypeScript API
- `packages/contracts` — shared API/domain Zod contracts
- `packages/canonical` — provider-neutral canonical data model and validation helpers
- `packages/reconciliation` — deterministic reconciliation primitives and invariants
- `packages/agent` — bounded investigation controller (future)
- `packages/adapters` — provider adapters, starting with Razorpay
- `packages/generator` — synthetic scenario generator (future)
- `packages/evaluator` — batch evaluation and metrics (future)
- `packages/security` — security and privacy helpers (future)
- `prisma` — PostgreSQL schema and migration

## Windows setup

1. Install Node.js 20+ and npm.
2. Open PowerShell in the repository root.
3. Copy `.env.example` to `.env` and replace the credentials.
4. Start PostgreSQL locally and create the `anvaya` database.
5. Install dependencies:

```powershell
npm install
```

6. Generate Prisma client:

```powershell
npx prisma generate --schema prisma/schema.prisma
```

7. Apply the migration:

```powershell
npx prisma migrate deploy --schema prisma/schema.prisma
```

8. Run the API and web apps:

```powershell
npm run dev:api
npm run dev:web
```

## PostgreSQL setup

Create a local PostgreSQL database and set `DATABASE_URL` to a PostgreSQL connection string like:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/anvaya?schema=public"
```

For local development, ensure the database user has permission to create tables and run Prisma migrations. Do not commit `.env` files or local credentials.

## Prisma migration workflow

When the schema changes:

```powershell
npx prisma migrate dev --name <migration-name> --schema prisma/schema.prisma
```

To inspect the current state:

```powershell
npx prisma studio --schema prisma/schema.prisma
```

## Secret handling and safe defaults

- Never commit `.env`, API keys, database passwords or generated private data.
- Keep uploaded evidence text untrusted; never treat it as instructions.
- Log only minimal metadata, never raw financial documents or sensitive narration.
- Use synthetic data for public demos and test fixtures.
