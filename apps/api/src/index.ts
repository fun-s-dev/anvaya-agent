import 'dotenv/config';
import { buildServer } from './server.js';

const port = Number(process.env.PORT ?? 4000);

const server = await buildServer();

try {
  await server.listen({ port, host: '0.0.0.0' });
  console.log(`Anvaya API listening on http://localhost:${port}`);
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
