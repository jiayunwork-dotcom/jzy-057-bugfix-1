import type { FastifyInstance } from 'fastify';
import { repo } from '../repo.js';
import { requireRole, requireUser, roleCan } from '../auth.js';
import { commentService } from '../services/commentService.js';
import { getRoom } from '../realtime/DocumentRoom.js';

export async function commentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/documents/:id/comments', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    if (!(await repo.getRole(id, user.id))) {
      return reply.code(403).send({ error: '无权访问' });
    }
    const comments = await commentService.listForDoc(id);
    return { comments };
  });

  app.post('/api/documents/:id/comments', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    await requireRole(id, user, roleCan.comment);
    const { quote, index } = req.body as { quote?: string; index?: number };
    if (!quote || typeof index !== 'number' || quote.length === 0) {
      return reply.code(400).send({ error: '需要选中正文片段 (quote, index)' });
    }
    const comment = await commentService.create(id, user.id, quote, index);
    const comments = await commentService.listForDoc(id);
    return { comment, comments };
  });

  app.post('/api/comments/:commentId/replies', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { commentId } = req.params as { commentId: string };
    const { body, docId } = req.body as { body?: string; docId?: string };
    if (!docId || !(await repo.getRole(docId, user.id))) {
      return reply.code(403).send({ error: '无权访问' });
    }
    await requireRole(docId, user, roleCan.comment);
    if (!body?.trim()) return reply.code(400).send({ error: '回复内容必填' });
    await commentService.reply(commentId, user.id, body.trim());
    const comments = await commentService.listForDoc(docId);
    return { comments };
  });

  // State: open (待处理) / resolved (已解决) / reopened (重新打开)
  app.put('/api/comments/:commentId/state', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { commentId } = req.params as { commentId: string };
    const { state, docId } = req.body as {
      state?: 'open' | 'resolved' | 'reopened';
      docId?: string;
    };
    if (!docId) return reply.code(400).send({ error: '缺少 docId' });
    const role = await repo.getRole(docId, user.id);
    if (!role) return reply.code(403).send({ error: '无权访问' });
    // Authors/editors resolve; reviewers may reopen; owners can do anything.
    if (state === 'resolved' && !roleCan.editBody(role)) {
      return reply.code(403).send({ error: '作者/编辑者才能标记已解决' });
    }
    if (state === 'reopened' && role === 'viewer') {
      return reply.code(403).send({ error: '只读者不能重新打开' });
    }
    if (!state || !['open', 'resolved', 'reopened'].includes(state)) {
      return reply.code(400).send({ error: '状态非法' });
    }
    await commentService.setState(commentId, state);
    const comments = await commentService.listForDoc(docId);
    return { comments };
  });

  // REST fallback of the current converged text (the WebSocket stays the main
  // channel; this endpoint is handy for tests and initial hydration).
  app.get('/api/documents/:id/text', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    if (!(await repo.getRole(id, user.id))) {
      return reply.code(403).send({ error: '无权访问' });
    }
    const room = await getRoom(id);
    return { text: room.text(), version: room.opCount() };
  });
}
