import type { FastifyInstance } from 'fastify';
import { repo } from '../repo.js';
import {
  hashPassword,
  newId,
  newToken,
  requireUser,
  verifyPassword,
} from '../auth.js';

const PALETTE = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
  '#42d4f4', '#f032e6', '#9a6324', '#808000', '#469990',
];

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register', async (req, reply) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password || password.length < 6) {
      return reply.code(400).send({ error: '用户名与至少 6 位密码必填' });
    }
    if (await repo.findUserByLogin(username)) {
      return reply.code(409).send({ error: '用户名已存在' });
    }
    const count = (await repo.listUsers()).length;
    const user = {
      id: newId('u'),
      username,
      pass_hash: hashPassword(password),
      color: PALETTE[count % PALETTE.length],
    };
    await repo.createUser(user);
    const token = newToken();
    await repo.issueToken(token, user.id);
    reply.setCookie('cmdtoken', token, { path: '/', httpOnly: true, sameSite: 'lax' });
    return { token, user: { id: user.id, username, color: user.color } };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body as { username?: string; password?: string };
    const row = await repo.findUserByLogin(username ?? '');
    if (!row || !verifyPassword(password ?? '', row.pass_hash)) {
      return reply.code(401).send({ error: '用户名或密码错误' });
    }
    const token = newToken();
    await repo.issueToken(token, row.id);
    reply.setCookie('cmdtoken', token, { path: '/', httpOnly: true, sameSite: 'lax' });
    return { token, user: { id: row.id, username: row.username, color: row.color } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)cmdtoken=([^;]+)/);
    if (cookie) await repo.revokeToken(decodeURIComponent(cookie[1]));
    reply.clearCookie('cmdtoken', { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const user = req.user;
    if (!user) return { user: null };
    return { user };
  });

  app.get('/api/users', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const users = await repo.listUsers();
    return { users };
  });
}
