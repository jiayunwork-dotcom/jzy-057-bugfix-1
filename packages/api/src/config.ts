export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://collab:collab@localhost:5432/collabmd',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  /** Auto checkpoint interval while the document keeps changing (ms). */
  autoVersionIntervalMs: Number(process.env.AUTO_VERSION_MS ?? 30_000),
  /** Quiet period without edits before an auto version is written (ms). */
  autoVersionQuietMs: Number(process.env.AUTO_VERSION_QUIET_MS ?? 5_000),
};

export type Role = 'owner' | 'editor' | 'reviewer' | 'viewer';

export const ROLES: Role[] = ['owner', 'editor', 'reviewer', 'viewer'];

export const roleCan = {
  editBody: (r: Role): boolean => r === 'owner' || r === 'editor',
  comment: (r: Role): boolean => r !== 'viewer',
  manage: (r: Role): boolean => r === 'owner',
  view: (_r: Role): boolean => true,
};
