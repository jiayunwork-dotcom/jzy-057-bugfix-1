import { describe, expect, it, vi } from 'vitest';

/**
 * Regression test for the "Invalid Date" shown in version history and on
 * comment/reply cards.
 *
 * node-postgres maps BIGINT columns to JavaScript *strings* (to survive
 * values beyond 2^53). Epoch-millis timestamps (`created_at`) and version
 * op offsets live in BIGINT columns, so every row reloaded from Postgres
 * carried a string `created_at`; the browser then evaluated
 * `new Date("1727123456789")`, which is an invalid date. Rows rendered fine
 * for a moment after creation because the services still held the in-memory
 * `Date.now()` number — the break appeared only after a refetch.
 *
 * The fake driver below reproduces that exact behaviour: BIGINT columns come
 * back as strings, just like against a real database.
 */
const { BIGINT_COLUMNS } = vi.hoisted(() => ({
  BIGINT_COLUMNS: {
    versions: ['op_offset', 'created_at'],
    comments: ['created_at'],
    comment_replies: ['created_at'],
    users: ['created_at'],
    tokens: ['created_at'],
    folders: ['created_at'],
    documents: ['created_at', 'updated_at'],
  } as Record<string, string[]>,
}));

vi.mock('../src/config.js', () => ({
  config: { autoVersionIntervalMs: 3_600_000, autoVersionQuietMs: 3_600_000 },
}));

vi.mock('pg', () => {
  const tables: Record<string, any[]> = {
    users: [],
    tokens: [],
    folders: [],
    documents: [],
    doc_members: [],
    doc_ops: [],
    versions: [],
    comments: [],
    comment_replies: [],
  };

  // Mimic node-postgres: BIGINT-typed values are returned as strings.
  const asDriverRow = (table: string, row: any): any => {
    const out = { ...row };
    for (const col of BIGINT_COLUMNS[table] ?? []) {
      if (out[col] !== null && out[col] !== undefined) out[col] = String(out[col]);
    }
    return out;
  };

  const tableOf = (sql: string): string | null => {
    const m = sql.match(/(?:INSERT INTO|FROM|UPDATE)\s+([a-z_]+)/i);
    return m && tables[m[1]] !== undefined ? m[1] : null;
  };

  class FakePool {
    async query(sql: string, params: any[] = []): Promise<{ rows: any[] }> {
      const s = sql.replace(/\s+/g, ' ').trim();

      if (s.startsWith('INSERT')) return this.insert(s, params);

      if (s.includes('FROM doc_ops')) {
        return {
          rows: tables.doc_ops
            .filter((r) => r.doc_id === params[0])
            .sort((a, b) => Number(a.seq) - Number(b.seq))
            .map((r) => ({ op: JSON.parse(r.op) })),
        };
      }
      if (s.includes('FROM versions WHERE') && s.includes('AND id=')) {
        const row = tables.versions.find(
          (r) => r.doc_id === params[0] && r.id === params[1],
        );
        return { rows: row ? [asDriverRow('versions', row)] : [] };
      }
      if (s.includes('FROM versions WHERE')) {
        return {
          rows: tables.versions
            .filter((r) => r.doc_id === params[0])
            .sort((a, b) => Number(a.created_at) - Number(b.created_at))
            .map((r) => asDriverRow('versions', r)),
        };
      }
      if (s.includes('FROM comments WHERE')) {
        return {
          rows: tables.comments
            .filter((r) => r.doc_id === params[0])
            .sort((a, b) => Number(a.created_at) - Number(b.created_at))
            .map((r) => asDriverRow('comments', r)),
        };
      }
      if (s.includes('FROM comment_replies')) {
        const ids = params[0] as string[];
        return {
          rows: tables.comment_replies
            .filter((r) => ids.includes(r.comment_id))
            .sort((a, b) => Number(a.created_at) - Number(b.created_at))
            .map((r) => asDriverRow('comment_replies', r)),
        };
      }
      if (s.includes('FROM users')) {
        return {
          rows: tables.users.map((r) => ({
            id: r.id,
            username: r.username,
            color: r.color,
          })),
        };
      }
      if (s.startsWith('UPDATE comments')) {
        const row = tables.comments.find((r) => r.id === params[0]);
        if (row) {
          row.anchor_idx = params[1];
          row.status = params[2];
        }
        return { rows: [] };
      }
      // BEGIN / COMMIT / ROLLBACK / UPDATE documents / SELECT 1 / ...
      return { rows: [] };
    }

    private async insert(s: string, params: any[]): Promise<{ rows: any[] }> {
      const table = tableOf(s)!;
      const colsMatch = s.match(/\(([^)]+)\)\s*VALUES/);
      const cols = colsMatch![1].split(',').map((x) => x.trim());
      const row: any = {};
      cols.forEach((c, i) => {
        row[c] = params[i];
      });
      tables[table].push(row);
      return { rows: [] };
    }

    async connect(): Promise<{
      query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
      release: () => void;
    }> {
      return {
        query: (sql: string, params: any[] = []) => this.query(sql, params),
        release: () => undefined,
      };
    }
  }

  return { default: { Pool: FakePool }, Pool: FakePool };
});

import { repo } from '../src/repo.js';
import { commentService } from '../src/services/commentService.js';
import { versionService } from '../src/services/versionService.js';
import { getRoom } from '../src/realtime/DocumentRoom.js';
import { CrdtDoc } from '@collabmd/core';

const expectValidDate = (ts: unknown): void => {
  expect(typeof ts).toBe('number');
  expect(Number.isNaN(new Date(ts as number).getTime())).toBe(false);
};

describe('BIGINT timestamp normalization (Invalid Date regression)', () => {
  it('listVersions returns numeric created_at/op_offset after a database reload', async () => {
    const ts = Date.UTC(2026, 8, 24, 10, 30, 0);
    await repo.insertVersion({
      id: 'v1',
      doc_id: 'd-versions',
      kind: 'snapshot',
      name: '基线',
      op_offset: 7,
      based_on: null,
      author: 'u1',
      created_at: ts,
    });

    const versions = await repo.listVersions('d-versions');
    expect(versions).toHaveLength(1);
    expect(versions[0].created_at).toBe(ts);
    expect(versions[0].op_offset).toBe(7);
    expectValidDate(versions[0].created_at);

    const single = await repo.getVersion('d-versions', 'v1');
    expectValidDate(single!.created_at);
    expect(single!.op_offset).toBe(7);
  });

  it('listComments/listReplies return numeric created_at after a database reload', async () => {
    const commentTs = Date.UTC(2026, 8, 24, 11, 0, 0);
    await repo.insertComment({
      id: 'c1',
      doc_id: 'd-comments',
      quote: 'anchor',
      anchor_idx: 6,
      status: 'anchored',
      thread_state: 'open',
      author: 'u2',
      created_at: commentTs,
    });
    const replyTs = commentTs + 5_000;
    await repo.insertReply({
      id: 'r1',
      comment_id: 'c1',
      author: 'u1',
      body: '收到',
      created_at: replyTs,
    });

    const comments = await repo.listComments('d-comments');
    expect(comments).toHaveLength(1);
    expect(comments[0].created_at).toBe(commentTs);
    expectValidDate(comments[0].created_at);

    const replies = await repo.listReplies(['c1']);
    expect(replies).toHaveLength(1);
    expect(replies[0].created_at).toBe(replyTs);
    expectValidDate(replies[0].created_at);
  });

  it('refetched comment + reply views carry valid numeric timestamps (page refresh)', async () => {
    const docId = 'svc-comments';
    const room = await getRoom(docId);
    const seed = new CrdtDoc();
    await room.ingest(seed.edit('u1', 0, 0, 'hello anchor text'), 'u1');

    await repo.createUser({
      id: 'u1',
      username: 'owner',
      pass_hash: 'x',
      color: '#ffffff',
    });
    await repo.createUser({
      id: 'u2',
      username: 'reviewer',
      pass_hash: 'x',
      color: '#000000',
    });

    // Fresh write: in-memory object already holds a number.
    const created = await commentService.create(docId, 'u2', 'anchor', 6);
    expectValidDate(created.created_at);
    await commentService.reply(created.id, 'u1', '收到');

    // Simulate a refresh: every timestamp now travels back through the
    // database driver (which yields BIGINT strings).
    const views = await commentService.listForDoc(docId);
    const view = views.find((c) => c.id === created.id);
    expect(view).toBeTruthy();
    expectValidDate(view!.created_at);
    expect(view!.replies).toHaveLength(1);
    expectValidDate(view!.replies[0].created_at);
  });

  it('refetched named snapshots carry a valid numeric timestamp', async () => {
    const docId = 'svc-versions';
    const room = await getRoom(docId);
    const seed = new CrdtDoc();
    await room.ingest(seed.edit('u1', 0, 0, 'snapshot body'), 'u1');

    const snapshot = await versionService.createSnapshot(docId, '评审基线', 'u1');
    expectValidDate(snapshot.created_at);

    // Reopen the history from the database, exactly like the browser does.
    const reloaded = await versionService.list(docId);
    const row = reloaded.find((v) => v.id === snapshot.id);
    expect(row).toBeTruthy();
    expectValidDate(row!.created_at);
    expect(typeof row!.op_offset).toBe('number');
  });
});
