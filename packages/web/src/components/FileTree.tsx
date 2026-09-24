import { useEffect, useRef, useState } from 'react';
import { api, type DocSummary, type Folder } from '../api/client';

interface Props {
  folders: Folder[];
  docs: DocSummary[];
  currentDocId: string | null;
  onOpenDoc: (id: string) => void;
  onChange: () => void;
  onError: (m: string) => void;
}

interface Menu {
  x: number;
  y: number;
  kind: 'folder' | 'doc' | 'root' | 'emptyFolder';
  id?: string;
  folderId?: string | null;
  title?: string;
}

const ROLE_TAG: Record<string, string> = {
  owner: '所有者',
  editor: '编辑者',
  reviewer: '评审者',
  viewer: '只读者',
};

export function FileTree({ folders, docs, currentDocId, onOpenDoc, onChange, onError }: Props) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (): void => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const childrenOf = (parent: string | null): Folder[] =>
    folders.filter((f) => f.parent_id === parent);
  const docsOf = (folder: string | null): DocSummary[] =>
    docs.filter((d) => d.folder_id === folder);

  const openMenu = (e: React.MouseEvent, m: Menu): void => {
    e.preventDefault();
    e.stopPropagation();
    setMenu(m);
  };

  const newFolder = async (parent: string | null): Promise<void> => {
    const name = prompt('新文件夹名称', '新文件夹');
    if (!name?.trim()) return;
    try {
      await api.createFolder(parent, name.trim());
      onChange();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const newDoc = async (folder: string | null): Promise<void> => {
    const title = prompt('新文档标题', '未命名文档');
    if (!title?.trim()) return;
    try {
      const { doc } = await api.createDoc(folder, title.trim());
      await onChange();
      onOpenDoc(doc.id);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const rename = async (m: Menu): Promise<void> => {
    const name = prompt('新名称', m.title);
    if (!name?.trim()) return;
    try {
      if (m.kind === 'folder') await api.renameFolder(m.id!, name.trim());
      else await api.renameDoc(m.id!, name.trim());
      onChange();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const move = async (m: Menu): Promise<void> => {
    const options = ['（根目录）', ...folders.map((f) => `${f.id}|${f.name}`)];
    const picked = prompt(
      `移动到：输入目标序号\n${options.map((o, i) => `${i}. ${o.split('|')[1] ?? o}`).join('\n')}`,
      '0',
    );
    if (picked === null) return;
    const idx = Number(picked);
    if (Number.isNaN(idx) || idx < 0 || idx >= options.length) return;
    const target = idx === 0 ? null : options[idx].split('|')[0];
    try {
      if (m.kind === 'folder') await api.moveFolder(m.id!, target);
      else await api.moveDoc(m.id!, target);
      onChange();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const remove = async (m: Menu): Promise<void> => {
    if (!confirm(m.kind === 'folder' ? '删除文件夹及其下文档？' : '删除该文档（含全部批注与版本）？')) return;
    try {
      if (m.kind === 'folder') await api.deleteFolder(m.id!);
      else await api.deleteDoc(m.id!);
      onChange();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const renderFolder = (f: Folder, depth: number): JSX.Element => (
    <div key={f.id}>
      <div
        className="tree-row"
        style={{ paddingLeft: 6 + depth * 14 }}
        onContextMenu={(e) =>
          openMenu(e, { x: e.clientX, y: e.clientY, kind: 'folder', id: f.id, folderId: f.id, title: f.name })
        }
      >
        <span>📁</span>
        <span className="name">{f.name}</span>
      </div>
      {childrenOf(f.id).map((c) => renderFolder(c, depth + 1))}
      {docsOf(f.id).map(renderDoc(depth + 1))}
    </div>
  );

  const renderDoc = (depth: number) => (d: DocSummary): JSX.Element => (
    <div
      key={d.id}
      className={`tree-row ${d.id === currentDocId ? 'active' : ''}`}
      style={{ paddingLeft: 6 + depth * 14 }}
      onClick={() => onOpenDoc(d.id)}
      onContextMenu={(e) =>
        openMenu(e, { x: e.clientX, y: e.clientY, kind: 'doc', id: d.id, folderId: d.folder_id, title: d.title })
      }
    >
      <span>📄</span>
      <span className="name">{d.title}</span>
      <span className="role-tag">{ROLE_TAG[d.role] ?? d.role}</span>
    </div>
  );

  return (
    <>
      <div
        className="tree"
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) openMenu(e, { x: e.clientX, y: e.clientY, kind: 'root', folderId: null });
        }}
      >
        {childrenOf(null).map((f) => renderFolder(f, 0))}
        {docsOf(null).map(renderDoc(0))}
        {folders.length === 0 && docs.length === 0 && (
          <div style={{ color: 'var(--muted)', padding: 12, fontSize: 12 }}>
            空白区域右键可新建文件夹 / 文档。
          </div>
        )}
      </div>

      {menu && (
        <div
          className="context-menu"
          ref={menuRef}
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => newDoc(menu.folderId ?? null)}>📄 新建文档</button>
          <button onClick={() => newFolder(menu.folderId ?? null)}>📁 新建文件夹</button>
          {(menu.kind === 'folder' || menu.kind === 'doc') && (
            <>
              <button onClick={() => rename(menu)}>重命名</button>
              <button onClick={() => move(menu)}>移动到…</button>
              <button className="danger" onClick={() => remove(menu)}>删除</button>
            </>
          )}
        </div>
      )}
    </>
  );
}
