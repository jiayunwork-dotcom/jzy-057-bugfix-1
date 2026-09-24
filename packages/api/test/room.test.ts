import { describe, expect, it, beforeEach, vi } from 'vitest';

// In-memory stub of the persistence layer so the room/service logic can be
// tested without Postgres.
vi.mock('../src/db.js', () => ({ pool: {} }));

const state = {
  ops: [] as any[],
  comments: [] as any[],
  versions: [] as any[],
};

vi.mock('../src/repo.js', () => ({
  repo: {
    loadOps: vi.fn(async () => state.ops),
    appendOps: vi.fn(async (_doc: string, startSeq: number, ops: any[]) => {
      state.ops.splice(startSeq, ops.length, ...ops);
    }),
    listComments: vi.fn(async () => state.comments),
    updateCommentAnchor: vi.fn(async (id: string, index: number, status: string) => {
      const c = state.comments.find((x) => x.id === id);
      c.anchor_idx = index;
      c.status = status;
    }),
    listVersions: vi.fn(async () => state.versions),
    insertVersion: vi.fn(async (v: any) => {
      state.versions.push(v);
    }),
  },
}));

vi.mock('../src/config.js', () => ({
  config: { autoVersionIntervalMs: 0, autoVersionQuietMs: 10_000 },
}));

import { DocumentRoom } from '../src/realtime/DocumentRoom.js';

beforeEach(() => {
  state.ops = [];
  state.comments = [];
  state.versions = [];
  vi.clearAllMocks();
});

describe('DocumentRoom collaboration pipeline', () => {
  it('dedupes reconnected op replays and persists only novel ops', async () => {
    const room = await DocumentRoom.load('d1');
    const { CrdtDoc } = await import('@collabmd/core');
    const client = new CrdtDoc();
    const ops = client.edit('alice', 0, 0, 'hello');

    const first = await room.ingest(ops, 'alice');
    expect(first.accepted).toHaveLength(ops.length);
    expect(room.text()).toBe('hello');

    // Reconnect resends the same history.
    const second = await room.ingest(ops, 'alice');
    expect(second.accepted).toHaveLength(0);
    expect(room.text()).toBe('hello');
  });

  it('merges concurrent edits from two authors into converged text', async () => {
    const room = await DocumentRoom.load('d2');
    const { CrdtDoc } = await import('@collabmd/core');
    const base = new CrdtDoc();
    const baseOps = base.edit('s', 0, 0, 'ab');
    await room.ingest(baseOps, 's');

    const a = new CrdtDoc();
    baseOps.forEach((o) => a.integrate(o));
    const b = new CrdtDoc();
    baseOps.forEach((o) => b.integrate(o));

    const ins = a.edit('alice', 1, 0, 'X');
    const del = b.edit('bob', 1, 1, '');

    // Interleaved delivery through the authoritative room.
    for (let i = 0; i < Math.max(ins.length, del.length); i++) {
      if (ins[i]) await room.ingest([ins[i]], 'alice');
      if (del[i]) await room.ingest([del[i]], 'bob');
    }
    expect(room.text()).toBe('aX');
  });

  it('re-anchors a comment when text is inserted before it', async () => {
    const room = await DocumentRoom.load('d3');
    const { CrdtDoc } = await import('@collabmd/core');
    const seed = new CrdtDoc();
    await room.ingest(seed.edit('s', 0, 0, 'keep this phrase here'), 's');

    state.comments.push({
      id: 'c1',
      doc_id: 'd3',
      quote: 'this phrase',
      anchor_idx: 5,
      status: 'anchored',
      thread_state: 'open',
      author: 'u1',
      created_at: 0,
    });

    const editor = new CrdtDoc();
    room.allOps().forEach((o) => editor.integrate(o));
    const insertAtFront = editor.edit('alice', 0, 0, 'PREFIX ');
    await room.ingest(insertAtFront, 'alice');

    const moved = state.comments[0];
    expect(moved.anchor_idx).toBe(12);
    expect(('PREFIX keep this phrase here').slice(
      moved.anchor_idx,
      moved.anchor_idx + 'this phrase'.length,
    )).toBe('this phrase');
  });
});
