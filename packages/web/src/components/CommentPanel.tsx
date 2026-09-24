import { useState } from 'react';
import { api, type Comment } from '../api/client';

interface Props {
  docId: string;
  comments: Comment[];
  canComment: boolean;
  canResolve: boolean;
  currentUserId?: string;
  onRefresh: () => void;
  onError: (m: string) => void;
  pendingQuote: { quote: string; index: number } | null;
  onConsumePending: () => void;
}

const fmt = (ts: number): string => new Date(ts).toLocaleString('zh-CN', { hour12: false });

const stateLabel: Record<Comment['thread_state'], string> = {
  open: '待处理',
  resolved: '已解决',
  reopened: '重新打开',
};

export function CommentPanel({
  docId,
  comments,
  canComment,
  canResolve,
  currentUserId,
  onRefresh,
  onError,
  pendingQuote,
  onConsumePending,
}: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newBody, setNewBody] = useState('');

  const createComment = async (): Promise<void> => {
    if (!pendingQuote) return;
    try {
      await api.addComment(docId, pendingQuote.quote, pendingQuote.index);
      onConsumePending();
      onRefresh();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const reply = async (commentId: string): Promise<void> => {
    const body = drafts[commentId]?.trim();
    if (!body) return;
    try {
      await api.reply(docId, commentId, body);
      setDrafts((d) => ({ ...d, [commentId]: '' }));
      onRefresh();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const setState = async (c: Comment, state: Comment['thread_state']): Promise<void> => {
    try {
      await api.setCommentState(docId, c.id, state);
      onRefresh();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <div className="comments-pane">
      <div className="pane-head">评审批注 · {comments.length}</div>
      <div className="comments-list">
        {pendingQuote && canComment && (
          <div className="comment-card" style={{ borderStyle: 'dashed' }}>
            <div className="quote">{pendingQuote.quote}</div>
            <div className="reply-form">
              <input
                autoFocus
                placeholder="写下你的批注…"
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && newBody.trim() && createComment()}
              />
              <button className="primary" onClick={createComment} disabled={!newBody.trim()}>
                批注
              </button>
              <button className="ghost" onClick={onConsumePending}>取消</button>
            </div>
          </div>
        )}

        {comments.length === 0 && !pendingQuote && (
          <div className="comments-empty">
            在左侧选中一段正文（一个词、一句话或一个段落），即可贴着该片段添加批注。
            <br />
            正文移动后批注会自动跟随；锚点文本被删除时会标记“锚点丢失”而不会消失。
          </div>
        )}

        {comments.map((c) => (
          <div key={c.id} className={`comment-card ${c.thread_state} ${c.status === 'lost' ? 'lost' : ''}`}>
            <div className="comment-head">
              <span className="avatar" style={{ background: c.color }}>{c.username.slice(0, 1)}</span>
              <span className="meta">
                <div>{c.username}</div>
                <small>{fmt(c.created_at)}</small>
              </span>
              {c.status === 'lost' && <span className="badge lost">锚点丢失</span>}
              <span className={`badge ${c.thread_state}`}>{stateLabel[c.thread_state]}</span>
            </div>
            <div className="quote">{c.quote}</div>
            <div className="thread">
              {c.replies.map((r) => (
                <div className="reply" key={r.id}>
                  <div className="rhead">
                    <span style={{ color: r.color, fontWeight: 600 }}>{r.username}</span> · {fmt(r.created_at)}
                  </div>
                  <div className="rbody">{r.body}</div>
                </div>
              ))}
            </div>
            {canComment && (
              <div className="reply-form">
                <input
                  placeholder="追加回复…"
                  value={drafts[c.id] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && reply(c.id)}
                />
                <button onClick={() => reply(c.id)} disabled={!drafts[c.id]?.trim()}>回复</button>
              </div>
            )}
            <div className="cmt-actions">
              {canResolve && c.thread_state !== 'resolved' && (
                <button className="primary" onClick={() => setState(c, 'resolved')}>标记已解决</button>
              )}
              {canComment && c.thread_state === 'resolved' && (
                <button onClick={() => setState(c, 'reopened')}>重新打开</button>
              )}
              {c.thread_state === 'reopened' && canResolve && (
                <button className="primary" onClick={() => setState(c, 'resolved')}>再次解决</button>
              )}
              {c.status === 'lost' && currentUserId && (
                <span className="badge lost" style={{ marginLeft: 'auto' }}>原文已被删除，内容保留</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
