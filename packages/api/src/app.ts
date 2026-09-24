import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { authHook } from './auth.js';
import { authRoutes } from './routes/auth.routes.js';
import { treeRoutes } from './routes/tree.routes.js';
import { commentRoutes } from './routes/comment.routes.js';
import { versionRoutes } from './routes/version.routes.js';

/** Build the HTTP app (REST interface layer) without binding to resources. */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.addHook('onRequest', authHook);
  app.get('/api/health', async () => ({ ok: true, ts: 1 }));
  await app.register(authRoutes);
  await app.register(treeRoutes);
  await app.register(commentRoutes);
  await app.register(versionRoutes);
  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { status?: number }).status ?? 500;
    reply.code(status).send({ error: err.message });
  });
  return app;
}
