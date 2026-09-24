import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Comment, type DocSummary } from '../api/client';
import { CollabSession } from '../collab/CollabSession';
import { Editor } from './Editor';
import { Preview } from './Preview';
import { CommentPanel } from './CommentPanel';
import { VersionHistory } from './VersionHistory';
import { MembersModal } from './MembersModal';
import { roleCan, type Role } from '../collab/roles';

interface Props {
  doc: DocSummary;
  user: { id: string; username: string; color: string };
  onDeleted: () => void;
  onError: (m: string) => void;
}

export function DocWorkspace({ doc, user, onDeleted, onError }: Props) {
  const sessionRef = useRef<CollabSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new CollabSession(doc.id);
  const session = sessionRef.current;

  const [, force] = useState(0);
  const [comments, setComments] = useState<Comment[]>([]);
  const [role, setRole] = useState<Role>(doc.role);
  const [pendingQuote, setPendingQuote] = useState<{ quote: string; index: number } | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const session = sessionRef.current!;
    session.connect();
    const unsub = session.subscribe(() => force((n) => n + 1));
    loadComments();
    loadRole();
    return () => {
      unsub();
      session.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  const loadComments = async (): Promise<void> => {
    try {
      const { comments } = await api.comments(doc.id);
      setComments(comments);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const loadRole = async (): Promise<void> => {
    try {
      const m = await api.members(doc.id);
      setRole(m.you);
    } catch {
      /* ignore */
    }
  };

  const text = session.text;
  const hydrated = session.you !== null;
  const canEdit = roleCan.editBody(role);
  const canComment = roleCan.comment(role);
  const canResolve = canEdit;

  const onlineOthers = useMemo(
    () => session.presence.filter((p) => p.userId !== user.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.presence],
  );

  const removeDoc = async (): Promise<void> => {
    if (!confirm(`删除文档「${doc.title}」？`)) return;
    try {
      await api.deleteDoc(doc.id);
      onDeleted();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <div className="workspace">
      <div className="topbar">
        <h2>{doc.title}</h2>
        <span className="conn">
          <span className={`dot ${session.connected ? 'on' : ''}`} />
          {session.connected ? '已连接' : '离线（改动将自动缓冲）'}
        </span>
        <div className="presence" title={onlineOthers.map((p) => p.username).join('、')}>
          {onlineOthers.map((p) => (
            <span key={p.userId} className="avatar" style={{ background: p.color }}>
              {p.username.slice(0, 1)}
            </span>
          ))}
          <span className="avatar self" style={{ background: user.color }}>{user.username.slice(0, 1)}</span>
        </div>
        <button onClick={() => setShowVersions(true)}>版本历史</button>
        <button onClick={() => setShowMembers(true)}>权限</button>
        {role === 'owner' && <button className="danger" onClick={removeDoc}>删除</button>}
      </div>

      {session.error && (
        <div style={{ background: '#fdecec', color: 'var(--danger)', padding: '6px 14px', fontSize: 12 }}>
          {session.error}
        </div>
      )}

      <div className="main">
        <div className="editor-pane">
          <div className="pane-head">
            Markdown 源码{canEdit ? '' : '（当前角色只读）'}
          </div>
          {hydrated ? (
            <Editor
              session={session}
              text={text}
              comments={comments}
              canEdit={canEdit}
              previewScrollRef={previewScrollRef}
              onSelect={(quote, index) => {
                if (canComment) setPendingQuote({ quote, index });
              }}
            />
          ) : (
            <div style={{ padding: 24, color: 'var(--muted)' }}>正在加载协作会话…</div>
          )}
        </div>
        <div className="preview-pane">
          <div className="pane-head">实时预览</div>
          {hydrated ? (
            <Preview
              text={text}
              scrollRef={(el) => {
                previewScrollRef.current = el;
              }}
            />
          ) : (
            <div style={{ padding: 24, color: 'var(--muted)' }}>正在加载…</div>
          )}
        </div>
        <CommentPanel
          docId={doc.id}
          comments={comments}
          canComment={canComment}
          canResolve={canResolve}
          currentUserId={user.id}
          onRefresh={loadComments}
          onError={onError}
          pendingQuote={pendingQuote}
          onConsumePending={() => setPendingQuote(null)}
        />
      </div>

      {showVersions && (
        <VersionHistory
          docId={doc.id}
          canEdit={canEdit}
          onClose={() => setShowVersions(false)}
          onChanged={() => force((n) => n + 1)}
          onError={onError}
        />
      )}
      {showMembers && (
        <MembersModal docId={doc.id} onClose={() => setShowMembers(false)} onError={onError} />
      )}
    </div>
  );
}
