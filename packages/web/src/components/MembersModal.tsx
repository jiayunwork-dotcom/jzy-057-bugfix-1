import { useEffect, useState } from 'react';
import { api, type Role, type User } from '../api/client';

interface Member {
  user_id: string;
  username: string;
  color: string;
  role: Role;
}

interface Props {
  docId: string;
  onClose: () => void;
  onError: (m: string) => void;
}

const LABEL: Record<Role, string> = {
  owner: '所有者',
  editor: '编辑者',
  reviewer: '评审者',
  viewer: '只读者',
};
const ASSIGNABLE: Role[] = ['editor', 'reviewer', 'viewer'];

export function MembersModal({ docId, onClose, onError }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [owner, setOwner] = useState<string>('');
  const [you, setYou] = useState<Role | null>(null);
  const [users, setUsers] = useState<User[]>([]);

  const load = async (): Promise<void> => {
    try {
      const [m, u] = await Promise.all([api.members(docId), api.users()]);
      setMembers(m.members);
      setOwner(m.owner);
      setYou(m.you);
      setUsers(u.users);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const assign = async (userId: string, role: Role | ''): Promise<void> => {
    try {
      if (role === '') {
        // removing membership is represented by viewer? Keep explicit: PUT is
        // upsert-only; demo uses reassignment. Provide delete via setting back
        // would need an endpoint, so just ignore empty here.
        return;
      }
      await api.setMemberRole(docId, userId, role);
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const memberIds = new Set(members.map((m) => m.user_id));
  const candidates = users.filter((u) => u.id !== owner && !memberIds.has(u.id));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 520 }}>
        <div className="modal-head">
          <h3>权限管理</h3>
          <button className="ghost" onClick={onClose}>关闭</button>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--muted)', marginTop: 0, fontSize: 13 }}>
            所有者完全控制；编辑者可改正文但不能删文档/改权限；评审者只能批注；只读者仅查看。
          </p>
          {members.map((m) => (
            <div className="members-row" key={m.user_id}>
              <span className="avatar" style={{ background: m.color }}>{m.username.slice(0, 1)}</span>
              <span className="grow">{m.username}</span>
              {you === 'owner' ? (
                <select value={m.role} onChange={(e) => assign(m.user_id, e.target.value as Role)}>
                  {ASSIGNABLE.map((r) => (
                    <option key={r} value={r}>{LABEL[r]}</option>
                  ))}
                </select>
              ) : (
                <span className="role-tag">{LABEL[m.role]}</span>
              )}
            </div>
          ))}
          {you === 'owner' && candidates.length > 0 && (
            <>
              <h4 style={{ margin: '18px 0 6px' }}>添加协作者</h4>
              {candidates.map((u) => (
                <div className="members-row" key={u.id}>
                  <span className="avatar" style={{ background: u.color }}>{u.username.slice(0, 1)}</span>
                  <span className="grow">{u.username}</span>
                  <select defaultValue="" onChange={(e) => assign(u.id, e.target.value as Role)}>
                    <option value="" disabled>选择角色…</option>
                    {ASSIGNABLE.map((r) => (
                      <option key={r} value={r}>{LABEL[r]}</option>
                    ))}
                  </select>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
