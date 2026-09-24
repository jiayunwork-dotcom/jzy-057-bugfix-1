import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { repo, type UserRow } from './repo.js';
import { roleCan, type Role } from './config.js';

export const hashPassword = (pw: string): string => bcrypt.hashSync(pw, 10);
export const verifyPassword = (pw: string, hash: string): boolean =>
  bcrypt.compareSync(pw, hash);
export const newToken = (): string => randomBytes(24).toString('hex');
export const newId = (p: string): string =>
  `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export interface AuthUser {
  id: string;
  username: string;
  color: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

function tokenFrom(req: FastifyRequest): string | null {
  const cookie = req.headers.cookie;
  if (cookie) {
    const m = cookie.match(/(?:^|;\s*)cmdtoken=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

export async function authHook(req: FastifyRequest): Promise<void> {
  const token = tokenFrom(req);
  if (!token) return;
  const row = await repo.userForToken(token);
  if (row) req.user = { id: row.id, username: row.username, color: row.color };
}

export function requireUser(req: FastifyRequest, reply: FastifyReply): AuthUser {
  if (!req.user) {
    reply.code(401).send({ error: 'unauthenticated' });
    throw Object.assign(new Error('unauthenticated'), { status: 401 });
  }
  return req.user;
}

/** Assert the user's role on the doc satisfies `check`. */
export async function requireRole(
  docId: string,
  user: AuthUser,
  check: (r: Role) => boolean,
): Promise<Role> {
  const role = await repo.getRole(docId, user.id);
  if (!role || !check(role)) {
    throw Object.assign(new Error('forbidden'), { status: 403 });
  }
  return role;
}

export { roleCan };
export type { UserRow };
