import { useCallback, useEffect, useState } from 'react';
import { api, type DocSummary, type Folder, type User } from './api/client';
import { Login } from './components/Login';
import { FileTree } from './components/FileTree';
import { DocWorkspace } from './components/DocWorkspace';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showError = useCallback((m: string): void => {
    setToast(m);
    setTimeout(() => setToast(null), 3200);
  }, []);

  const refreshTree = useCallback(async (): Promise<void> => {
    if (!user) return;
    try {
      const tree = await api.tree();
      setFolders(tree.folders);
      setDocs(tree.docs);
      if (currentId && !tree.docs.some((d) => d.id === currentId)) setCurrentId(null);
    } catch (e) {
      showError((e as Error).message);
    }
  }, [user, currentId, showError]);

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (user) refreshTree();
  }, [user, refreshTree]);

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  const current = docs.find((d) => d.id === currentId) ?? null;

  const logout = async (): Promise<void> => {
    await api.logout().catch(() => undefined);
    localStorage.removeItem('cmdtoken');
    setUser(null);
    setCurrentId(null);
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="brand">📝 CollabMD</span>
        </div>
        <div className="sidebar-actions">
          <button
            onClick={async () => {
              const title = prompt('新文档标题', '未命名文档');
              if (!title?.trim()) return;
              const { doc } = await api.createDoc(null, title.trim());
              await refreshTree();
              setCurrentId(doc.id);
            }}
          >
            + 文档
          </button>
          <button
            onClick={async () => {
              const name = prompt('新文件夹名称', '新文件夹');
              if (!name?.trim()) return;
              await api.createFolder(null, name.trim());
              refreshTree();
            }}
          >
            + 文件夹
          </button>
        </div>
        <FileTree
          folders={folders}
          docs={docs}
          currentDocId={currentId}
          onOpenDoc={setCurrentId}
          onChange={refreshTree}
          onError={showError}
        />
        <div className="sidebar-foot">
          <span className="avatar" style={{ background: user.color }}>{user.username.slice(0, 1)}</span>
          <span className="who">
            {user.username}
            <br />
            <small>已登录</small>
          </span>
          <button className="ghost" onClick={logout}>退出</button>
        </div>
      </aside>

      <main className="workspace" style={{ display: 'flex' }}>
        {current ? (
          <div key={current.id} style={{ display: 'flex', flex: 1, minWidth: 0, flexDirection: 'column' }}>
            <DocWorkspace
              doc={current}
              user={user}
              onDeleted={async () => {
                setCurrentId(null);
                await refreshTree();
              }}
              onError={showError}
            />
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--muted)',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 44 }}>📄</div>
            <div>从左侧选择一篇文档，或新建一篇开始协作</div>
            <div style={{ fontSize: 12 }}>
              多人实时 CRDT · 批注锚定跟随 · 版本快照 / diff / 回滚
            </div>
          </div>
        )}
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
