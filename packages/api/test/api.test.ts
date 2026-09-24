import { describe, expect, it, beforeAll, vi } from 'vitest';
import bcrypt from 'bcryptjs';

// ---- in-memory persistence ---------------------------------------------
interface U { id: string; username: string; pass_hash: string; color: string }
interface Doc { id: string; folder_id: string | null; title: string; owner_id: string }

const db = {
  users: new Map<string, U>(),
  tokens: new Map<string, string>(),
  docs: new Map<string, Doc>(),
  members: new Map<string, string>(), // `${docId}:${userId}` -> role
  ops: new Map<string, any[]>(),
  versions: new Map<string, any[]>(),
  comments: new Map<string, any[]>(),
  replies: new Map<string, any[]>(),
};

const membersKey = (d: string, u: string) => `${d}:${u}`;

vi.mock('../src/db.js', () => ({ pool: {} }));
vi.mock('../src/redis.js', () => ({ connectRedis: vi.fn(), redis: vi.fn() }));

vi.mock('../src/repo.js', () => {
  const roleOf = (docId: string, userId: string) => {
    const doc = db.docs.get(docId);
    if (!doc) return null;
    if (doc.owner_id === userId) return 'owner';
    return db.members.get(membersKey(docId, userId)) ?? null;
  };
  return {
    repo: {
      findUserByLogin: async (username: string) =>
        [...db.users.values()].find((u) => u.username === username) ?? null,
      createUser: async (u: U) => void db.users.set(u.id, { ...u }),
      issueToken: async (t: string, uid: string) => void db.tokens.set(t, uid),
      revokeToken: async (t: string) => void db.tokens.delete(t),
      userForToken: async (t: string) => {
        const uid = db.tokens.get(t);
        return uid ? db.users.get(uid) ?? null : null;
      },
      listUsers: async () => [...db.users.values()].map(({ id, username, color }) => ({ id, username, color })),

      listFolders: async () => [],
      createFolder: vi.fn(),
      renameFolder: vi.fn(),
      moveFolder: vi.fn(),
      deleteFolder: vi.fn(),

      listDocsAccessible: async (userId: string) =>
        [...db.docs.values()]
          .map((d) => ({ ...d, role: roleOf(d.id, userId) }))
          .filter((d) => d.role),
      getDoc: async (id: string) => db.docs.get(id) ?? null,
      createDoc: vi.fn(async (d: Doc) => void db.docs.set(d.id, { ...d })),
      renameDoc: vi.fn(),
      moveDoc: vi.fn(),
      deleteDoc: async (id: string) => void db.docs.delete(id),
      touchDoc: vi.fn(),

      getRole: roleOf,
      setRole: async (d: string, u: string, r: string) =>
        void db.members.set(membersKey(d, u), r),
      listMembers: async (docId: string) =>
        [...db.members.entries()]
          .filter(([k]) => k.startsWith(`${docId}:`))
          .map(([k, role]) => {
            const uid = k.split(':')[1];
            const u = db.users.get(uid)!;
            return { user_id: uid, username: u.username, color: u.color, role };
          }),

      loadOps: async (d: string) => db.ops.get(d) ?? [],
      appendOps: async (d: string, start: number, ops: any[]) => {
        const arr = db.ops.get(d) ?? [];
        arr.splice(start, ops.length, ...ops);
        db.ops.set(d, arr);
      },

      listVersions: async (d: string) => db.versions.get(d) ?? [],
      insertVersion: async (v: any) => {
        const arr = db.versions.get(v.doc_id) ?? [];
        arr.push(v);
        db.versions.set(v.doc_id, arr);
      },
      getVersion: async (d: string, id: string) =>
        (db.versions.get(d) ?? []).find((v) => v.id === id) ?? null,

      listComments: async (d: string) => db.comments.get(d) ?? [],
      insertComment: async (c: any) => {
        const arr = db.comments.get(c.doc_id) ?? [];
        arr.push(c);
        db.comments.set(c.doc_id, arr);
      },
      updateCommentAnchor: async (id: string, idx: number, status: string) => {
        for (const arr of db.comments.values()) {
          const c = arr.find((x) => x.id === id);
          if (c) {
            c.anchor_idx = idx;
            c.status = status;
          }
        }
      },
      setCommentState: async (id: string, s: string) => {
        for (const arr of db.comments.values()) {
          const c = arr.find((x) => x.id === id);
          if (c) c.thread_state = s;
        }
      },
      listReplies: async (ids: string[]) =>
        [...db.replies.values()].flat().filter((r) => ids.includes(r.comment_id)),
      insertReply: async (r: any) => {
        const arr = db.replies.get(r.comment_id) ?? [];
        arr.push(r);
        db.replies.set(r.comment_id, arr);
      },
    },
  };
});

import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';
import { getRoom } from '../src/realtime/DocumentRoom.js';
import { CrdtDoc } from '@collabmd/core';

let app: FastifyInstance;
const DOC = 'doc1';

async function tokenFor(username: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

async function asUser(token: string) {
  const headers = { cookie: `cmdtoken=${token}` };
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers }),
    post: (url: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url, headers, payload }),
    put: (url: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'PUT', url, headers, payload }),
  };
}

beforeAll(async () => {
  app = await buildApp();
  // seed users
  const mk = (id: string, username: string, color: string, pw: string): U => ({
    id, username, color, pass_hash: bcrypt.hashSync(pw, 10),
  });
  for (const u of [
    mk('u-owner', 'owner', '#4363d8', 'owner123'),
    mk('u-editor', 'editor', '#3cb44b', 'editor123'),
    mk('u-reviewer', 'reviewer', '#f58231', 'reviewer123'),
    mk('u-viewer', 'viewer', '#911eb4', 'viewer123'),
  ]) {
    await (await import('../src/repo.js')).repo.createUser(u);
  }
  db.docs.set(DOC, { id: DOC, folder_id: null, title: '设计', owner_id: 'u-owner' });
  await (await import('../src/repo.js')).repo.setRole(DOC, 'u-editor', 'editor');
  await (await import('../src/repo.js')).repo.setRole(DOC, 'u-reviewer', 'reviewer');
  await (await import('../src/repo.js')).repo.setRole(DOC, 'u-viewer', 'viewer');

  // seed CRDT text through a real room
  const room = await getRoom(DOC);
  const seed = new CrdtDoc();
  await room.ingest(seed.edit('seed', 0, 0, 'Title\nanchor phrase here\nend'), 'seed');
});

describe('REST interface layer', () => {
  it('rejects unauthenticated access', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tree' });
    expect(res.statusCode).toBe(401);
  });

  it('enforces body-edit vs comment-only permissions', async () => {
    const reviewerTok = await tokenFor('reviewer', 'reviewer123');
    const reviewer = await asUser(reviewerTok);
    // reviewer cannot snapshot (body mutation)
    const snap = await reviewer.post(`/api/documents/${DOC}/snapshots`, { name: 'x' });
    expect(snap.statusCode).toBe(403);

    const viewerTok = await tokenFor('viewer', 'viewer123');
    const viewer = await asUser(viewerTok);
    const cmt = await viewer.post(`/api/documents/${DOC}/comments`, {
      quote: 'Title',
      index: 0,
    });
    expect(cmt.statusCode).toBe(403);

    // only owner manages permissions
    const editorTok = await tokenFor('editor', 'editor123');
    const editor = await asUser(editorTok);
    const perm = await editor.put(`/api/documents/${DOC}/members/u-viewer`, { role: 'editor' });
    expect(perm.statusCode).toBe(403);
  });

  it('anchors a comment and follows it after text inserted before it', async () => {
    const reviewerTok = await tokenFor('reviewer', 'reviewer123');
    const reviewer = await asUser(reviewerTok);
    const created = await reviewer.post(`/api/documents/${DOC}/comments`, {
      quote: 'anchor phrase',
      index: 6,
    });
    expect(created.statusCode).toBe(200);
    let comments = (created.json() as { comments: any[] }).comments;
    const comment = comments.find((c) => c.quote === 'anchor phrase');
    expect(comment).toBeTruthy();
    expect(comment.status).toBe('anchored');

    // Owner inserts 7 chars at the very front through the CRDT room.
    const room = await getRoom(DOC);
    const local = new CrdtDoc();
    room.allOps().forEach((o) => local.integrate(o));
    const ops = local.edit('owner', 0, 0, 'PREFIX-');
    await room.ingest(ops, 'u-owner');

    const res = await reviewer.get(`/api/documents/${DOC}/comments`);
    comments = (res.json() as { comments: any[] }).comments;
    const moved = comments.find((c) => c.id === comment.id);
    expect(moved.index).toBe(13);
    expect('PREFIX-Title\nanchor phrase here\nend'.slice(moved.index, moved.end)).toBe(
      'anchor phrase',
    );
  });

  it('supports the full snapshot -> edit -> diff -> rollback flow', async () => {
    const ownerTok = await tokenFor('owner', 'owner123');
    const owner = await asUser(ownerTok);

    const snapRes = await owner.post(`/api/documents/${DOC}/snapshots`, { name: '基线' });
    expect(snapRes.statusCode).toBe(200);
    const snap = (snapRes.json() as { version: any }).version;
    expect(snap.kind).toBe('snapshot');
    expect(snap.name).toBe('基线');

    // Mutate body: replace "end" with "END!"
    const room = await getRoom(DOC);
    const local = new CrdtDoc();
    room.allOps().forEach((o) => local.integrate(o));
    const text = local.text();
    const idx = text.indexOf('end');
    const ops = local.edit('owner', idx, 3, 'END!');
    await room.ingest(ops, 'u-owner');

    const snap2Res = await owner.post(`/api/documents/${DOC}/snapshots`, { name: '改动后' });
    const snap2 = (snap2Res.json() as { version: any }).version;

    const diffRes = await owner.get(
      `/api/documents/${DOC}/diff?from=${snap.id}&to=${snap2.id}`,
    );
    const rows = (diffRes.json() as { rows: any[] }).rows;
    expect(rows.some((r) => r.type === 'modify')).toBe(true);

    // Roll back to the baseline; head text must equal baseline again.
    const rb = await owner.post(`/api/documents/${DOC}/rollback`, { versionId: snap.id });
    expect(rb.statusCode).toBe(200);
    const rollbackVersion = (rb.json() as { version: any }).version;
    expect(rollbackVersion.kind).toBe('rollback');
    expect(rollbackVersion.based_on).toBe(snap.id);

    const textRes = await owner.get(`/api/documents/${DOC}/text`);
    const head = (textRes.json() as { text: string }).text;
    expect(head).toContain('anchor phrase here\nend');
    expect(head).not.toContain('END!');

    // Intermediate snapshot content remains reachable (history not lost).
    const mid = await owner.get(`/api/documents/${DOC}/versions/${snap2.id}/text`);
    expect((mid.json() as { text: string }).text).toContain('END!');
  });
});
