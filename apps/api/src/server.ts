import fastifyCors from '@fastify/cors';
import Fastify from 'fastify';

import { casesRoutes } from './routes/cases.js';
import { importsRoutes } from './routes/imports.js';

export async function buildServer() {
  const app = Fastify({
    logger: false,
  });

  await app.register(fastifyCors, {
    origin: true,
  });

  await app.register(importsRoutes);
  await app.register(casesRoutes);

  app.get('/health', async () => ({
    ok: true,
    service: 'anvaya-api',
    timestamp: new Date().toISOString(),
  }));

  return app;
}
