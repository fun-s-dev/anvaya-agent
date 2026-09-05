/**
 * server.ts - Fastify server configuration.
 *
 * CORS: configurable via FRONTEND_URL env var.
 * In development (no FRONTEND_URL set), all origins are allowed.
 * In production, set FRONTEND_URL to restrict access.
 */

import fastifyCors from '@fastify/cors';
import Fastify from 'fastify';

import { casesRoutes } from './routes/cases.js';
import { importsRoutes } from './routes/imports.js';
import { reconciliationRoutes } from './routes/reconciliation.js';

export async function buildServer() {
  const app = Fastify({
    logger: false,
  });

  // CORS: restrict to configured frontend origin in production.
  const frontendUrl = process.env.FRONTEND_URL;
  await app.register(fastifyCors, {
    origin: frontendUrl ? [frontendUrl, 'http://localhost:3000', 'http://localhost:4000'] : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(importsRoutes);
  await app.register(casesRoutes);
  await app.register(reconciliationRoutes);

  app.get('/health', async () => ({
    ok: true,
    service: 'anvaya-api',
    timestamp: new Date().toISOString(),
    mode: process.env.ANVAYA_DEMO_STORE === 'memory' ? 'memory' : 'postgresql',
    databaseConfigured: Boolean(process.env.DATABASE_URL),
  }));

  return app;
}
