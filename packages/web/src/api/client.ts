export interface User {
  id: string;
  username: string;
  color: string;
}
export type Role = 'owner' | 'editor' | 'reviewer' | 'viewer';

export interface Folder {
  id: string;
  parent_id: string | null;
  name: string;
  owner_id: string;
}
export interface DocSummary {
  id: string;
  folder_id: string | null;
  title: string;
  owner_id: string;
  role: Role;
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
export interface Reply {
  id: string;
  comment_id: string;
  author: string;
  username: string;
  color: string;
  body: string;
  created_at: number;
}
export interface Comment {
  id: string;
  quote: string;
  anchor_idx: number;
  index: number;
  end: number;
  status: 'anchored' | 'lost';
  thread_state: 'open' | 'resolved' | 'reopened';
  author: string;
  username: string;
  color: string;
  created_at: number;
  replies: Reply[];
}

export interface DiffRow {
  type: 'equal' | 'insert' | 'delete' | 'modify';
  oldLine: number | null;
  newLine: number | null;
  text: string;
  oldParts?: { type: 'equal' | 'insert' | 'delete'; value: string[] }[];
  newParts?: { type: 'equal' | 'insert' | 'delete'; value: string[] }[];
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `请求失败 ${res.status}`);
  return body as T;
}

export const api = {
  me: () => req<{ user: User | null }>('/api/auth/me'),
  login: (username: string, password: string) =>
    req<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  register: (username: string, password: string) =>
    req<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => req('/api/auth/logout', { method: 'POST' }),
  users: () => req<{ users: User[] }>('/api/users'),

  tree: () => req<{ folders: Folder[]; docs: DocSummary[] }>('/api/tree'),
  createFolder: (parentId: string | null, name: string) =>
    req('/api/folders', { method: 'POST', body: JSON.stringify({ parentId, name }) }),
  renameFolder: (id: string, name: string) =>
    req(`/api/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  moveFolder: (id: string, parentId: string | null) =>
    req(`/api/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ parentId }) }),
  deleteFolder: (id: string) => req(`/api/folders/${id}`, { method: 'DELETE' }),

  createDoc: (folderId: string | null, title: string) =>
    req<{ doc: DocSummary }>('/api/documents', {
      method: 'POST',
      body: JSON.stringify({ folderId, title }),
    }),
  renameDoc: (id: string, title: string) =>
    req(`/api/documents/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  moveDoc: (id: string, folderId: string | null) =>
    req(`/api/documents/${id}`, { method: 'PATCH', body: JSON.stringify({ folderId }) }),
  deleteDoc: (id: string) => req(`/api/documents/${id}`, { method: 'DELETE' }),
  members: (id: string) =>
    req<{ owner: string; members: { user_id: string; username: string; color: string; role: Role }[]; you: Role }>(
      `/api/documents/${id}/members`,
    ),
  setMemberRole: (id: string, userId: string, role: Role) =>
    req(`/api/documents/${id}/members/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),

  comments: (id: string) => req<{ comments: Comment[] }>(`/api/documents/${id}/comments`),
  addComment: (id: string, quote: string, index: number) =>
    req<{ comments: Comment[] }>(`/api/documents/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ quote, index }),
    }),
  reply: (docId: string, commentId: string, body: string) =>
    req<{ comments: Comment[] }>(`/api/comments/${commentId}/replies`, {
      method: 'POST',
      body: JSON.stringify({ docId, body }),
    }),
  setCommentState: (docId: string, commentId: string, state: 'open' | 'resolved' | 'reopened') =>
    req<{ comments: Comment[] }>(`/api/comments/${commentId}/state`, {
      method: 'PUT',
      body: JSON.stringify({ docId, state }),
    }),

  versions: (id: string) => req<{ versions: VersionRow[] }>(`/api/documents/${id}/versions`),
  snapshot: (id: string, name: string) =>
    req(`/api/documents/${id}/snapshots`, { method: 'POST', body: JSON.stringify({ name }) }),
  diff: (id: string, from: string, to: string) =>
    req<{ rows: DiffRow[] }>(`/api/documents/${id}/diff?from=${from}&to=${to}`),
  versionText: (id: string, v: string) =>
    req<{ text: string }>(`/api/documents/${id}/versions/${v}/text`),
  rollback: (id: string, versionId: string) =>
    req(`/api/documents/${id}/rollback`, { method: 'POST', body: JSON.stringify({ versionId }) }),
};
