import { useEffect, useState } from 'react';
import { api, type DiffRow, type VersionRow } from '../api/client';

interface Props {
  docId: string;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
  onError: (m: string) => void;
}

const kindLabel: Record<VersionRow['kind'], string> = {
  auto: '自动版本',
  snapshot: '命名快照',
  rollback: '回滚版本',
};

const fmt = (ts: number): string => new Date(ts).toLocaleString('zh-CN', { hour12: false });

export function VersionHistory({ docId, canEdit, onClose, onChanged, onError }: Props) {
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [name, setName] = useState('');
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [rows, setRows] = useState<DiffRow[] | null>(null);

  const load = async (): Promise<void> => {
    const { versions } = await api.versions(docId);
    setVersions(versions);
  };
  useEffect(() => {
    load().catch((e) => onError((e as Error).message));
  }, []);

  const snapshot = async (): Promise<void> => {
    if (!name.trim()) return;
    try {
      await api.snapshot(docId, name.trim());
      setName('');
      await load();
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const runDiff = async (): Promise<void> => {
    if (!from || !to) return;
    try {
      const { rows } = await api.diff(docId, from, to);
      setRows(rows);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const rollback = async (v: VersionRow): Promise<void> => {
    const label = v.name ? `「${v.name}」` : fmt(v.created_at);
    if (!confirm(`确认把正文回滚到 ${label}？\n回滚本身会作为一个新版本记录，中间修改不会丢失。`)) return;
    try {
      await api.rollback(docId, v.id);
      await load();
      onChanged();
      onClose();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const pick = (v: VersionRow): void => {
    if (!from) setFrom(v.id);
    else if (!to) setTo(v.id);
    else {
      setFrom(v.id);
      setTo(null);
      setRows(null);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>版本历史</h3>
          <button className="ghost" onClick={onClose}>关闭</button>
        </div>
        <div className="modal-body">
          {canEdit && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <input
                style={{ flex: 1 }}
                placeholder="为当前状态创建命名快照，如「评审基线 v2」"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && snapshot()}
              />
              <button className="primary" onClick={snapshot} disabled={!name.trim()}>创建快照</button>
            </div>
          )}

          <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 8 }}>
            依次点选两个版本对比（旧 → 新）：
            {from && <span className="kind-tag" style={{ marginLeft: 8 }}>A 已选</span>}
            {to && <span className="kind-tag" style={{ marginLeft: 6 }}>B 已选</span>}
            <button className="ghost" style={{ marginLeft: 8 }} onClick={() => { setFrom(null); setTo(null); setRows(null); }}>
              清除
            </button>
            <button className="primary" style={{ marginLeft: 8 }} disabled={!from || !to} onClick={runDiff}>
              对比
            </button>
          </div>

          {rows ? (
            <DiffView rows={rows} />
          ) : (
            <div className="v-list">
              {[...versions].reverse().map((v) => (
                <div
                  key={v.id}
                  className={`v-row ${from === v.id || to === v.id ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    checked={from === v.id || to === v.id}
                    readOnly
                    onClick={() => pick(v)}
                  />
                  <span className={`kind-tag ${v.kind}`}>{kindLabel[v.kind]}</span>
                  <span className="grow">
                    <strong>{v.name ?? '自动保存'}</strong>
                    <br />
                    <small>{fmt(v.created_at)} · ops {v.op_offset}{v.based_on ? ' · 回滚版本' : ''}</small>
                  </span>
                  {canEdit && (
                    <button onClick={() => rollback(v)}>回滚到此版本</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DiffView({ rows }: { rows: DiffRow[] }) {
  return (
    <table className="diff-table">
      <tbody>
        {rows.map((r, i) => {
          if (r.type === 'equal') {
            return (
              <tr key={i} className="row-equal">
                <td className="lineno">{r.oldLine}</td>
                <td className="lineno">{r.newLine}</td>
                <td className="code">{r.text}</td>
              </tr>
            );
          }
          if (r.type === 'insert') {
            return (
              <tr key={i} className="row-insert">
                <td className="lineno"></td>
                <td className="lineno">{r.newLine}</td>
                <td className="code"><Inline parts={r.newParts} base="ins" /> </td>
              </tr>
            );
          }
          if (r.type === 'delete') {
            return (
              <tr key={i} className="row-delete">
                <td className="lineno">{r.oldLine}</td>
                <td className="lineno"></td>
                <td className="code"><Inline parts={r.oldParts} base="del" /></td>
              </tr>
            );
          }
          return (
            <tr key={i} className="row-modify-pair">
              <td colSpan={3} style={{ padding: 0 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr className="row-delete">
                      <td className="lineno" style={{ width: 44 }}>{r.oldLine}</td>
                      <td className="lineno" style={{ width: 44 }}></td>
                      <td className="code"><Inline parts={r.oldParts} base="del" /></td>
                    </tr>
                    <tr className="row-insert">
                      <td className="lineno">{r.newLine}</td>
                      <td className="lineno"></td>
                      <td className="code"><Inline parts={r.newParts} base="ins" /></td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Inline({
  parts,
  base,
}: {
  parts?: { type: 'equal' | 'insert' | 'delete'; value: string[] }[];
  base: 'ins' | 'del';
}) {
  if (!parts) return null;
  return (
    <>
      {parts.map((p, i) => {
        const text = p.value.join('');
        if (p.type === 'equal') return <span key={i}>{text}</span>;
        const cls = p.type === 'insert' ? 'char-ins' : 'char-del';
        // For insert-side rows, delete parts are filtered out by the kernel and
        // vice versa, so highlighting only needs the single changed class.
        void base;
        return <span key={i} className={cls}>{text}</span>;
      })}
    </>
  );
}
