import {
  CrdtDoc,
  diffText,
  materialize,
  rollbackOps,
  type LineDiffRow,
} from '@collabmd/core';
import { repo, type VersionRow } from '../repo.js';
import { getRoom } from '../realtime/DocumentRoom.js';

async function history(docId: string) {
  const [versions, ops] = await Promise.all([
    repo.listVersions(docId),
    repo.loadOps(docId),
  ]);
  return { versions, ops };
}

export const versionService = {
  async list(docId: string) {
    const versions = await repo.listVersions(docId);
    return versions;
  },

  /** Flush any pending room edits, then record a named snapshot right now. */
  async createSnapshot(
    docId: string,
    name: string,
    author: string,
  ): Promise<VersionRow> {
    const room = await getRoom(docId);
    await room.flushNow();
    const id = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const row: VersionRow = {
      id,
      doc_id: docId,
      kind: 'snapshot',
      name,
      op_offset: room.opCount(),
      based_on: null,
      author,
      created_at: Date.now(),
    };
    await repo.insertVersion(row);
    return row;
  },

  async getText(docId: string, versionId: string): Promise<string> {
    const h = await history(docId);
    const v = h.versions.find((x) => x.id === versionId);
    if (!v) throw new Error('version not found');
    const doc = new CrdtDoc();
    for (const op of h.ops.slice(0, v.op_offset)) doc.integrate(op);
    return doc.text();
  },

  /** Line + char-level diff between any two versions. */
  async diff(docId: string, fromId: string, toId: string): Promise<LineDiffRow[]> {
    const h = await history(docId);
    const from = materialize(
      { versions: h.versions.map(toMeta), ops: h.ops },
      fromId,
    ).text;
    const to = materialize(
      { versions: h.versions.map(toMeta), ops: h.ops },
      toId,
    ).text;
    return diffText(from, to);
  },

  /**
   * Non-destructive rollback: append ops that transform head into the target
   * snapshot text, then record a rollback version pointing at the target.
   */
  async rollback(
    docId: string,
    targetId: string,
    author: string,
  ): Promise<VersionRow> {
    const targetText = await this.getText(docId, targetId);
    const room = await getRoom(docId);
    const ops = rollbackOps(room.doc, targetText, `rollback:${author}`);
    if (ops.length > 0) await room.appendSystemOps(ops, author);
    const id = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const row: VersionRow = {
      id,
      doc_id: docId,
      kind: 'rollback',
      name: `回滚到 ${targetId}`,
      op_offset: room.opCount(),
      based_on: targetId,
      author,
      created_at: Date.now(),
    };
    await repo.insertVersion(row);
    room.markClean();
    return row;
  },
};

function toMeta(v: VersionRow) {
  return {
    id: v.id,
    kind: v.kind,
    name: v.name,
    createdAt: v.created_at,
    opOffset: v.op_offset,
    basedOn: v.based_on,
  };
}
