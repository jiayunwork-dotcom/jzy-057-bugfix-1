import { pool } from './db.js';
import type { Op } from '@collabmd/core';
import type { Role } from './config.js';

export interface UserRow {
  id: string;
  username: string;
  pass_hash: string;
  color: string;
}

export interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  owner_id: string;
}

export interface DocRow {
  id: string;
  folder_id: string | null;
  title: string;
  owner_id: string;
}

export interface VersionRow {
  id: string;
  doc_id: string;
  kind: 'auto' | 'snapshot' | 'rollback';
  name: string | null;
  op_offset: number;
  based_on: string | null;
  author: string;
  created_at: number;
}

export interface CommentRow {
  id: string;
  doc_id: string;
  quote: string;
  anchor_idx: number;
  status: 'anchored' | 'lost';
  thread_state: 'open' | 'resolved' | 'reopened';
  author: string;
  created_at: number;
}

export interface ReplyRow {
  id: string;
  comment_id: string;
  author: string;
  body: string;
  created_at: number;
}

const now = (): number => Date.now();

export const repo = {
  // ---- users / auth ----
  async findUserByLogin(username: string): Promise<UserRow | null> {
    const r = await pool.query<UserRow>(
      'SELECT id, username, pass_hash, color FROM users WHERE username=$1',
      [username],
    );
    return r.rows[0] ?? null;
  },
  async createUser(u: UserRow & { pass_hash: string }): Promise<void> {
    await pool.query(
      'INSERT INTO users(id, username, pass_hash, color, created_at) VALUES($1,$2,$3,$4,$5)',
      [u.id, u.username, u.pass_hash, u.color, now()],
    );
  },
  async issueToken(token: string, userId: string): Promise<void> {
    await pool.query('INSERT INTO tokens(token,user_id,created_at) VALUES($1,$2,$3)', [
      token,
      userId,
      now(),
    ]);
  },
  async userForToken(token: string): Promise<UserRow | null> {
    const r = await pool.query<UserRow>(
      `SELECT u.id,u.username,u.pass_hash,u.color FROM tokens t
       JOIN users u ON u.id=t.user_id WHERE t.token=$1`,
      [token],
    );
    return r.rows[0] ?? null;
  },
  async revokeToken(token: string): Promise<void> {
    await pool.query('DELETE FROM tokens WHERE token=$1', [token]);
  },
  async listUsers(): Promise<Array<{ id: string; username: string; color: string }>> {
    const r = await pool.query('SELECT id,username,color FROM users ORDER BY username');
    return r.rows;
  },

  // ---- folders ----
  async listFolders(userId: string): Promise<FolderRow[]> {
    const r = await pool.query<FolderRow>(
      `SELECT id,parent_id,name,owner_id FROM folders
       WHERE owner_id=$1 ORDER BY name`,
      [userId],
    );
    return r.rows;
  },
  async createFolder(id: string, parentId: string | null, name: string, owner: string): Promise<FolderRow> {
    await pool.query(
      'INSERT INTO folders(id,parent_id,name,owner_id,created_at) VALUES($1,$2,$3,$4,$5)',
      [id, parentId, name, owner, now()],
    );
    return { id, parent_id: parentId, name, owner_id: owner };
  },
  async renameFolder(id: string, name: string): Promise<void> {
    await pool.query('UPDATE folders SET name=$2 WHERE id=$1', [id, name]);
  },
  async moveFolder(id: string, parentId: string | null): Promise<void> {
    await pool.query('UPDATE folders SET parent_id=$2 WHERE id=$1', [id, parentId]);
  },
  async deleteFolder(id: string): Promise<void> {
    await pool.query('DELETE FROM folders WHERE id=$1', [id]);
  },

  // ---- documents ----
  async listDocsAccessible(userId: string): Promise<Array<DocRow & { role: Role }>> {
    const r = await pool.query(
      `SELECT d.id,d.folder_id,d.title,d.owner_id,
              COALESCE(m.role, CASE WHEN d.owner_id=$1 THEN 'owner' ELSE NULL END) AS role
       FROM documents d
       LEFT JOIN doc_members m ON m.doc_id=d.id AND m.user_id=$1
       WHERE d.owner_id=$1 OR m.user_id IS NOT NULL
       ORDER BY d.updated_at DESC`,
      [userId],
    );
    return r.rows;
  },
  async getDoc(id: string): Promise<DocRow | null> {
    const r = await pool.query<DocRow>(
      'SELECT id,folder_id,title,owner_id FROM documents WHERE id=$1',
      [id],
    );
    return r.rows[0] ?? null;
  },
  async createDoc(id: string, folderId: string | null, title: string, owner: string): Promise<DocRow> {
    await pool.query(
      `INSERT INTO documents(id,folder_id,title,owner_id,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$5)`,
      [id, folderId, title, owner, now()],
    );
    return { id, folder_id: folderId, title, owner_id: owner };
  },
  async renameDoc(id: string, title: string): Promise<void> {
    await pool.query('UPDATE documents SET title=$2,updated_at=$3 WHERE id=$1', [
      id,
      title,
      now(),
    ]);
  },
  async moveDoc(id: string, folderId: string | null): Promise<void> {
    await pool.query('UPDATE documents SET folder_id=$2,updated_at=$3 WHERE id=$1', [
      id,
      folderId,
      now(),
    ]);
  },
  async deleteDoc(id: string): Promise<void> {
    await pool.query('DELETE FROM documents WHERE id=$1', [id]);
  },
  async touchDoc(id: string): Promise<void> {
    await pool.query('UPDATE documents SET updated_at=$2 WHERE id=$1', [id, now()]);
  },

  // ---- membership / permissions ----
  async getRole(docId: string, userId: string): Promise<Role | null> {
    const doc = await this.getDoc(docId);
    if (!doc) return null;
    if (doc.owner_id === userId) return 'owner';
    const r = await pool.query<{ role: Role }>(
      'SELECT role FROM doc_members WHERE doc_id=$1 AND user_id=$2',
      [docId, userId],
    );
    return r.rows[0]?.role ?? null;
  },
  async setRole(docId: string, userId: string, role: Role): Promise<void> {
    await pool.query(
      `INSERT INTO doc_members(doc_id,user_id,role) VALUES($1,$2,$3)
       ON CONFLICT (doc_id,user_id) DO UPDATE SET role=EXCLUDED.role`,
      [docId, userId, role],
    );
  },
  async listMembers(docId: string): Promise<Array<{ user_id: string; username: string; color: string; role: Role }>> {
    const r = await pool.query(
      `SELECT u.user_id, us.username, us.color, u.role FROM doc_members u
       JOIN users us ON us.id=u.user_id WHERE u.doc_id=$1 ORDER BY us.username`,
      [docId],
    );
    return r.rows;
  },

  // ---- crdt op log ----
  async loadOps(docId: string): Promise<Op[]> {
    const r = await pool.query<{ op: Op }>(
      'SELECT op FROM doc_ops WHERE doc_id=$1 ORDER BY seq',
      [docId],
    );
    return r.rows.map((x) => x.op);
  },
  async nextOpSeq(docId: string): Promise<number> {
    const r = await pool.query<{ max: string | null }>(
      'SELECT max(seq)::text AS max FROM doc_ops WHERE doc_id=$1',
      [docId],
    );
    return r.rows[0].max === null ? 0 : Number(r.rows[0].max) + 1;
  },
  async appendOps(docId: string, startSeq: number, ops: Op[], author: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < ops.length; i++) {
        await client.query(
          'INSERT INTO doc_ops(doc_id,seq,op,author) VALUES($1,$2,$3,$4)',
          [docId, startSeq + i, JSON.stringify(ops[i]), author],
        );
      }
      await client.query('UPDATE documents SET updated_at=$2 WHERE id=$1', [
        docId,
        Date.now(),
      ]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  // ---- versions ----
  async listVersions(docId: string): Promise<VersionRow[]> {
    const r = await pool.query<VersionRow>(
      'SELECT id,doc_id,kind,name,op_offset,based_on,author,created_at FROM versions WHERE doc_id=$1 ORDER BY created_at',
      [docId],
    );
    return r.rows;
  },
  async insertVersion(v: VersionRow): Promise<void> {
    await pool.query(
      `INSERT INTO versions(id,doc_id,kind,name,op_offset,based_on,author,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [v.id, v.doc_id, v.kind, v.name, v.op_offset, v.based_on, v.author, v.created_at],
    );
  },
  async getVersion(docId: string, versionId: string): Promise<VersionRow | null> {
    const r = await pool.query<VersionRow>(
      'SELECT id,doc_id,kind,name,op_offset,based_on,author,created_at FROM versions WHERE doc_id=$1 AND id=$2',
      [docId, versionId],
    );
    return r.rows[0] ?? null;
  },

  // ---- comments ----
  async listComments(docId: string): Promise<CommentRow[]> {
    const r = await pool.query<CommentRow>(
      'SELECT id,doc_id,quote,anchor_idx,status,thread_state,author,created_at FROM comments WHERE doc_id=$1 ORDER BY created_at',
      [docId],
    );
    return r.rows;
  },
  async insertComment(c: CommentRow): Promise<void> {
    await pool.query(
      `INSERT INTO comments(id,doc_id,quote,anchor_idx,status,thread_state,author,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [c.id, c.doc_id, c.quote, c.anchor_idx, c.status, c.thread_state, c.author, c.created_at],
    );
  },
  async updateCommentAnchor(
    id: string,
    anchorIdx: number,
    status: 'anchored' | 'lost',
  ): Promise<void> {
    await pool.query('UPDATE comments SET anchor_idx=$2,status=$3 WHERE id=$1', [
      id,
      anchorIdx,
      status,
    ]);
  },
  async setCommentState(id: string, threadState: 'open' | 'resolved' | 'reopened'): Promise<void> {
    await pool.query('UPDATE comments SET thread_state=$2 WHERE id=$1', [id, threadState]);
  },
  async listReplies(commentIds: string[]): Promise<ReplyRow[]> {
    if (commentIds.length === 0) return [];
    const r = await pool.query<ReplyRow>(
      `SELECT id,comment_id,author,body,created_at FROM comment_replies
       WHERE comment_id = ANY($1) ORDER BY created_at`,
      [commentIds],
    );
    return r.rows;
  },
  async insertReply(r: ReplyRow): Promise<void> {
    await pool.query(
      'INSERT INTO comment_replies(id,comment_id,author,body,created_at) VALUES($1,$2,$3,$4,$5)',
      [r.id, r.comment_id, r.author, r.body, r.created_at],
    );
  },
};
