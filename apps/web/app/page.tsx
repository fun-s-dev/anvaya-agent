export default function HomePage() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Anvaya Foundation</h1>
      <p>
        Provider-neutral canonical data boundary and ingestion foundation are ready.
      </p>
      <ul>
        <li>Monorepo with web and API apps</li>
        <li>Prisma + PostgreSQL schema for canonical financial state</li>
        <li>Type-safe contracts for imports and core data</li>
        <li>Deterministic duplicate prevention for stable source records</li>
      </ul>
    </main>
  );
}
