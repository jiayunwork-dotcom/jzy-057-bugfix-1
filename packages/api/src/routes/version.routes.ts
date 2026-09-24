import type { FastifyInstance } from 'fastify';
import { repo } from '../repo.js';
import { requireRole, requireUser, roleCan } from '../auth.js';
import { versionService } from '../services/versionService.js';

export async function versionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/documents/:id/versions', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    if (!(await repo.getRole(id, user.id))) {
      return reply.code(403).send({ error: '无权访问' });
    }
    const versions = await versionService.list(id);
    return { versions };
  });

  app.post('/api/documents/:id/snapshots', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    // Reviewers/viewers can't mutate the body, snapshots freeze body state.
    await requireRole(id, user, roleCan.editBody);
    const { name } = req.body as { name?: string };
    const version = await versionService.createSnapshot(id, name?.trim() || '未命名快照', user.id);
    return { version };
  });

  app.get('/api/documents/:id/versions/:vid/text', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id, vid } = req.params as { id: string; vid: string };
    if (!(await repo.getRole(id, user.id))) {
      return reply.code(403).send({ error: '无权访问' });
    }
    const text = await versionService.getText(id, vid);
    return { text };
  });

  app.get('/api/documents/:id/diff', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) return reply.code(400).send({ error: '需要 from/to 版本 id' });
    if (!(await repo.getRole(id, user.id))) {
      return reply.code(403).send({ error: '无权访问' });
    }
    const rows = await versionService.diff(id, from, to);
    return { rows };
  });

  app.post('/api/documents/:id/rollback', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    await requireRole(id, user, roleCan.editBody);
    const { versionId } = req.body as { versionId?: string };
    if (!versionId) return reply.code(400).send({ error: '需要 versionId' });
    const version = await versionService.rollback(id, versionId, user.id);
    return { version };
  });
}
