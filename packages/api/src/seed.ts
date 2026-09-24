import { CrdtDoc } from '@collabmd/core';
import { pool } from './db.js';
import { repo } from './repo.js';
import { hashPassword, newId } from './auth.js';

const STARTER = `# 协作评审示例文档

欢迎来到 **CollabMD** —— 一篇可以多人*实时协作*的 Markdown 技术文档。

## 核心能力

1. CRDT 实时合并，离线编辑自动收敛
2. 贴着正文的评审批注与讨论线程
3. 增量版本、命名快照、差异对比与一键回滚

\`\`\`ts
// 每个字符都有全局唯一标识
const id: Id = [lamport, clientId];
\`\`\`

> 选中这一段文字，点击「加批注」即可开始评审。

| 角色 | 正文 | 批注 | 管理 |
| --- | --- | --- | --- |
| 所有者 | ✅ | ✅ | ✅ |
| 编辑者 | ✅ | ✅ | ❌ |
| 评审者 | ❌ | ✅ | ❌ |
| 只读者 | ❌ | ❌ | ❌ |

- [x] 注册账号
- [ ] 打开本文档
- [ ] 邀请协作者并分配角色
- [ ] 创建一个命名快照

[项目文档约定](https://example.com/style-guide) 评审时请遵守。
`;

interface SeedUser {
  username: string;
  password: string;
  color: string;
}

const USERS: SeedUser[] = [
  { username: 'owner', password: 'owner123', color: '#4363d8' },
  { username: 'editor', password: 'editor123', color: '#3cb44b' },
  { username: 'reviewer', password: 'reviewer123', color: '#f58231' },
  { username: 'viewer', password: 'viewer123', color: '#911eb4' },
];

export async function seed(): Promise<void> {
  const existing = await pool.query('SELECT COUNT(*)::int AS c FROM users');
  if (existing.rows[0].c > 0) return;

  const ids: Record<string, string> = {};
  for (const u of USERS) {
    const id = newId('u');
    ids[u.username] = id;
    await repo.createUser({
      id,
      username: u.username,
      pass_hash: hashPassword(u.password),
      color: u.color,
    });
  }

  const folder = await repo.createFolder(newId('f'), null, '设计文档', ids.owner);
  const sub = await repo.createFolder(newId('f'), folder.id, '评审中', ids.owner);
  const doc = await repo.createDoc(newId('d'), sub.id, 'CollabMD 快速上手', ids.owner);

  // Seed the CRDT op log with the starter markdown.
  const crdt = new CrdtDoc();
  const ops = crdt.edit('seed', 0, 0, STARTER);
  await repo.appendOps(doc.id, 0, ops, 'seed');

  // Reviewer/editor/viewer memberships on the demo doc.
  await repo.setRole(doc.id, ids.editor, 'editor');
  await repo.setRole(doc.id, ids.reviewer, 'reviewer');
  await repo.setRole(doc.id, ids.viewer, 'viewer');

  // Baseline snapshot + one auto version.
  await repo.insertVersion({
    id: newId('v'),
    doc_id: doc.id,
    kind: 'snapshot',
    name: '初始基线',
    op_offset: ops.length,
    based_on: null,
    author: 'seed',
    created_at: Date.now() - 60_000,
  });

  // A second demo doc owned by editor to show shared trees.
  await repo.createDoc(newId('d'), folder.id, '接口草案（编辑者所有）', ids.editor);

  console.log('seed complete: owner/editor/reviewer/viewer with demo doc');
}
