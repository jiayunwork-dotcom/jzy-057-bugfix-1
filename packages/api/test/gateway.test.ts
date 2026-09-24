import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';

vi.mock('../src/db.js', () => ({ pool: {} }));

const hashes = new Map<string, Map<string, string>>();
vi.mock('../src/redis.js', () => ({
  connectRedis: vi.fn(),
  presenceKey: (docId: string) => `presence:${docId}`,
  redis: () => ({
    hset: async (k: string, f: string, v: string) => {
      if (!hashes.has(k)) hashes.set(k, new Map());
      hashes.get(k)!.set(f, v);
    },
    hgetall: async (k: string) => Object.fromEntries(hashes.get(k) ?? new Map()),
    hdel: async (k: string, f: string) => void hashes.get(k)?.delete(f),
    expire: async () => undefined,
  }),
}));

const db = {
  users: new Map<string, any>(),
  tokens: new Map<string, string>(),
  docs: new Map<string, any>(),
  members: new Map<string, string>(),
};

vi.mock('../src/repo.js', () => ({
  repo: {
    userForToken: async (t: string) => {
      const uid = db.tokens.get(t);
      return uid ? db.users.get(uid) ?? null : null;
    },
    listUsers: async () =>
      [...db.users.values()].map(({ id, username, color }) => ({ id, username, color })),
    getRole: async (docId: string, uid: string) => {
      const doc = db.docs.get(docId);
      if (!doc) return null;
      return doc.owner_id === uid ? 'owner' : (db.members.get(`${docId}:${uid}`) ?? null);
    },
    loadOps: async () => [],
    appendOps: vi.fn(async () => undefined),
    listComments: async () => [],
    listReplies: async () => [],
    updateCommentAnchor: vi.fn(),
    listVersions: async () => [],
    insertVersion: vi.fn(),
  },
}));

import bcrypt from 'bcryptjs';
import { RealtimeGateway } from '../src/realtime/RealtimeGateway.js';
import { CrdtDoc } from '@collabmd/core';

const DOC = 'realtime-doc';
let port: number;
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  hashes.clear();
  db.users.clear();
  db.tokens.clear();
  db.docs.clear();
  db.members.clear();
  db.users.set('u1', {
    id: 'u1',
    username: 'alice',
    pass_hash: bcrypt.hashSync('x', 8),
    color: '#f00',
  });
  db.users.set('u2', {
    id: 'u2',
    username: 'bob',
    pass_hash: bcrypt.hashSync('x', 8),
    color: '#0f0',
  });
  db.tokens.set('tok1', 'u1');
  db.tokens.set('tok2', 'u2');
  db.docs.set(DOC, { id: DOC, owner_id: 'u1' });
  db.members.set(`${DOC}:u2`, 'editor');

  server = createServer();
  new RealtimeGateway(server, 30_000);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function connect(token: string): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/ws/${DOC}?token=${token}`);
}

function waitFor(cond: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (cond()) resolve();
      else timer = setTimeout(tick, 20);
    };
    let timer = setTimeout(tick, 0);
    setTimeout(() => {
      clearTimeout(timer);
      reject(new Error(`timeout @${label}`));
    }, timeoutMs);
  });
}

describe('realtime gateway', () => {
  it('streams init, broadcasts remote ops, and syncs colored presence', async () => {
    const aliceInbox: any[] = [];
    const bobInbox: any[] = [];
    const alice = connect('tok1');
    const bob = connect('tok2');
    alice.on('message', (raw: Buffer) => aliceInbox.push(JSON.parse(raw.toString())));
    bob.on('message', (raw: Buffer) => bobInbox.push(JSON.parse(raw.toString())));

    await waitFor(() => aliceInbox.some((m) => m.t === 'init'), 'alice-init');
    const aliceInit = aliceInbox.find((m) => m.t === 'init')!;
    expect(aliceInit.you.username).toBe('alice');
    expect(aliceInit.you.role).toBe('owner');
    await waitFor(() => bobInbox.some((m) => m.t === 'init'), 'bob-init');

    // Both eventually see each other in presence.
    await waitFor(
      () =>
        aliceInbox.some(
          (m) => m.t === 'presence' && m.users.some((u: any) => u.userId === 'u2'),
        ),
      'presence',
    );
    const seenByAlice = aliceInbox
      .filter((m) => m.t === 'presence')
      .find((m) => m.users.some((u: any) => u.userId === 'u2'));
    expect(seenByAlice.users).toHaveLength(2);

    // Bob edits through the socket; Alice receives the converged ops.
    const local = new CrdtDoc();
    const ops = local.edit('u2', 0, 0, 'hi');
    const before = aliceInbox.filter((m) => m.t === 'ops').flatMap((m) => m.ops).length;
    bob.send(JSON.stringify({ t: 'ops', ops }));
    await waitFor(
      () => aliceInbox.filter((m) => m.t === 'ops').flatMap((m) => m.ops).length >= before + ops.length,
      'ops-broadcast',
    );
    const received = aliceInbox.filter((m) => m.t === 'ops').flatMap((m) => m.ops);
    expect(received).toHaveLength(ops.length);

    // Bob moves his cursor/selection; Alice sees the colored presence update.
    bob.send(JSON.stringify({ t: 'cursor', cursor: 1, selStart: 1, selEnd: 2 }));
    bob.send(JSON.stringify({ t: 'cursor', cursor: 2, selStart: 2, selEnd: 2 }));
    await waitFor(
      () =>
        aliceInbox.some(
          (m) =>
            m.t === 'presence' &&
            m.users.find((u: any) => u.userId === 'u2' && u.cursor === 2 && u.selEnd === 2),
        ),
      'cursor-sync',
    );
    const pres = aliceInbox
      .filter((m) => m.t === 'presence')
      .find((m) => m.users.find((u: any) => u.userId === 'u2' && u.cursor === 2));
    const bobPresence = pres.users.find((u: any) => u.userId === 'u2');
    expect(bobPresence.color).toBe('#0f0');
    expect(bobPresence.username).toBe('bob');

    alice.close();
    bob.close();
  }, 10_000);

  it('refuses a bad token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/${DOC}?token=nope`);
    const code = await new Promise<number>((resolve) => {
      ws.on('close', (c) => resolve(c));
      ws.on('error', () => resolve(0));
    });
    expect(code).toBe(1008);
  });
});
