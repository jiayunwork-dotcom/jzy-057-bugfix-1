import type { FastifyInstance } from 'fastify';
import { repo } from '../repo.js';
import { newId, requireUser } from '../auth.js';

export async function treeRoutes(app: FastifyInstance): Promise<void> {
  // Folders + documents the current user can see, as a flat list; the client
  // builds the tree using parent ids.
  app.get('/api/tree', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const [folders, docs] = await Promise.all([
      repo.listFolders(user.id),
      repo.listDocsAccessible(user.id),
    ]);
    return { folders, docs };
  });

  app.post('/api/folders', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { parentId, name } = req.body as { parentId?: string | null; name?: string };
    if (!name?.trim()) return reply.code(400).send({ error: '文件夹名称必填' });
    const folder = await repo.createFolder(newId('f'), parentId ?? null, name.trim(), user.id);
    return { folder };
  });

  app.patch('/api/folders/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const { name, parentId } = req.body as { name?: string; parentId?: string | null };
    if (name !== undefined) await repo.renameFolder(id, name);
    if (parentId !== undefined) await repo.moveFolder(id, parentId);
    return { ok: true };
  });

  app.delete('/api/folders/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    await repo.deleteFolder((req.params as { id: string }).id);
    return { ok: true };
  });

  app.post('/api/documents', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { folderId, title } = req.body as { folderId?: string | null; title?: string };
    const doc = await repo.createDoc(
      newId('d'),
      folderId ?? null,
      title?.trim() || '未命名文档',
      user.id,
    );
    return { doc, role: 'owner' };
  });

  app.patch('/api/documents/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const role = await repo.getRole(id, user.id);
    if (!role) return reply.code(403).send({ error: '无权访问' });
    const { title, folderId } = req.body as { title?: string; folderId?: string | null };
    // Only owner renames; editors+ may move within the tree.
    if (title !== undefined) {
      if (role !== 'owner') return reply.code(403).send({ error: '只有所有者可重命名' });
      await repo.renameDoc(id, title);
    }
    if (folderId !== undefined) await repo.moveDoc(id, folderId);
    return { ok: true };
  });

  app.delete('/api/documents/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const doc = await repo.getDoc(id);
    if (!doc || doc.owner_id !== user.id) {
      return reply.code(403).send({ error: '只有所有者可删除文档' });
    }
    await repo.deleteDoc(id);
    return { ok: true };
  });

  // ---- permissions ----
  app.get('/api/documents/:id/members', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const role = await repo.getRole(id, user.id);
    if (!role) return reply.code(403).send({ error: '无权访问' });
    const doc = await repo.getDoc(id);
    const members = await repo.listMembers(id);
    return {
      owner: doc?.owner_id,
      members,
      you: role,
    };
  });

  app.put('/api/documents/:id/members/:userId', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id, userId } = req.params as { id: string; userId: string };
    const role = await repo.getRole(id, user.id);
    if (role !== 'owner') return reply.code(403).send({ error: '只有所有者可改权限' });
    const { role: newRole } = req.body as { role?: string };
    if (!['editor', 'reviewer', 'viewer'].includes(newRole ?? '')) {
      return reply.code(400).send({ error: '角色非法' });
    }
    await repo.setRole(id, userId, newRole as never);
    return { ok: true };
  });
}
