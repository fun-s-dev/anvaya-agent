import fastifyCors from '@fastify/cors';
import Fastify from 'fastify';

import { importsRoutes } from './routes/imports.js';

export async function buildServer() {
  const app = Fastify({
    logger: false,
  });

  await app.register(fastifyCors, {
    origin: true,
  });

  await app.register(importsRoutes);

  app.get('/health', async () => ({
    ok: true,
    service: 'anvaya-api',
    timestamp: new Date().toISOString(),
  }));

  return app;
}
