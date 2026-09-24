import { resolveAnchor } from '@collabmd/core';
import { repo, type CommentRow, type ReplyRow } from '../repo.js';
import { getRoom } from '../realtime/DocumentRoom.js';

const newId = (p: string): string =>
  `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export interface CommentView {
  id: string;
  doc_id: string;
  quote: string;
  anchor_idx: number;
  index: number;
  end: number;
  status: 'anchored' | 'lost';
  thread_state: 'open' | 'resolved' | 'reopened';
  author: string;
  created_at: number;
  username: string;
  color: string;
  replies: Array<ReplyRow & { username: string; color: string }>;
}

export const commentService = {
  async listForDoc(docId: string): Promise<CommentView[]> {
    const room = await getRoom(docId);
    const text = room.text();
    const comments = await repo.listComments(docId);
    const replies = await repo.listReplies(comments.map((c) => c.id));
    const userIds = [
      ...new Set([...comments.map((c) => c.author), ...replies.map((r) => r.author)]),
    ];
    const users = new Map(
      (await repo.listUsers())
        .filter((u) => userIds.includes(u.id))
        .map((u) => [u.id, u]),
    );
    return comments.map((c) => {
      const r = resolveAnchor(
        { quote: c.quote, index: c.anchor_idx, status: c.status },
        text,
      );
      const author = users.get(c.author);
      return {
        ...c,
        anchor_idx: r.index,
        index: r.index,
        end: r.end,
        status: r.status,
        username: author?.username ?? '未知',
        color: author?.color ?? '#888',
        replies: replies
          .filter((rp) => rp.comment_id === c.id)
          .map((rp) => {
            const u = users.get(rp.author);
            return { ...rp, username: u?.username ?? '未知', color: u?.color ?? '#888' };
          }),
      };
    });
  },

  async create(
    docId: string,
    author: string,
    quote: string,
    index: number,
  ): Promise<CommentRow> {
    // Validate the selection against current text at creation time.
    const room = await getRoom(docId);
    const text = room.text();
    const safeIndex = Math.max(0, Math.min(index, Math.max(0, text.length - quote.length)));
    const row: CommentRow = {
      id: newId('c'),
      doc_id: docId,
      quote,
      anchor_idx: safeIndex,
      status: 'anchored',
      thread_state: 'open',
      author,
      created_at: Date.now(),
    };
    await repo.insertComment(row);
    return row;
  },

  async reply(commentId: string, author: string, body: string): Promise<ReplyRow> {
    const row: ReplyRow = {
      id: newId('r'),
      comment_id: commentId,
      author,
      body,
      created_at: Date.now(),
    };
    await repo.insertReply(row);
    return row;
  },

  /** open(=待处理) -> resolved(=已解决) -> reopened(=重新打开) -> resolved ... */
  async setState(
    commentId: string,
    state: 'open' | 'resolved' | 'reopened',
  ): Promise<void> {
    await repo.setCommentState(commentId, state);
  },
};
