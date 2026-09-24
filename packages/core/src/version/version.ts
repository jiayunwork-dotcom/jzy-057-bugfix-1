/**
 * Version kernel.
 *
 * A document lives as a CRDT op log. Versions are *incremental*: each version
 * (auto checkpoint or named snapshot) only records the range of op log entries
 * accumulated since the previous version; materialising a version replays the
 * whole log up to that point through a fresh CrdtDoc.
 *
 * Rollback is non-destructive: it aligns the current text against the target
 * snapshot text with Myers and appends fresh CRDT edits that perform the
 * transformation, stored as a new version. Every intermediate edit survives.
 */

import { CrdtDoc } from '../crdt/CrdtDoc.js';
import type { Op } from '../crdt/types.js';
import { diffText, myers, type LineDiffRow } from '../diff/diff.js';

export type VersionKind = 'auto' | 'snapshot' | 'rollback';

export interface VersionMeta {
  id: string;
  kind: VersionKind;
  name: string | null;
  createdAt: number;
  /** Op log index at which this version ends (exclusive end offset). */
  opOffset: number;
  /** For rollback versions: the version id rolled back to. */
  basedOn: string | null;
}

export interface MaterializedVersion {
  meta: VersionMeta;
  text: string;
}

export interface VersionHistory {
  versions: VersionMeta[];
  /** Ordered CRDT op log shared by all versions (the document kernel). */
  ops: Op[];
}

export function materialize(history: VersionHistory, versionId: string): MaterializedVersion {
  const meta = history.versions.find((v) => v.id === versionId);
  if (!meta) throw new Error(`unknown version: ${versionId}`);
  const doc = new CrdtDoc();
  for (const op of history.ops.slice(0, meta.opOffset)) doc.integrate(op);
  return { meta, text: doc.text() };
}

/** Current materialised document (whole log applied). */
export function materializeHead(history: VersionHistory): string {
  const doc = new CrdtDoc();
  for (const op of history.ops) doc.integrate(op);
  return doc.text();
}

/** Line + intra-line diff between any two versions. */
export function diffVersions(
  history: VersionHistory,
  fromId: string,
  toId: string,
): LineDiffRow[] {
  const from = materialize(history, fromId).text;
  const to = materialize(history, toId).text;
  return diffText(from, to);
}

/**
 * Compute CRDT edits that transform `currentText` into `targetText`.
 * Uses char-level Myers so unchanged characters (and their ids / anchors) are
 * preserved — only genuinely different characters are removed/reinserted.
 */
export function rollbackOps(
  currentDoc: CrdtDoc,
  targetText: string,
  clientId: string,
): Op[] {
  const currentText = currentDoc.text();
  const charsA = [...currentText];
  const charsB = [...targetText];
  const parts = myers(charsA, charsB);

  // Build replacement segments. Apply from the end so visible indices stay
  // stable while editing, mirroring a single Coordinated replacement per run.
  interface Seg {
    index: number;
    delCount: number;
    insert: string;
  }
  const segs: Seg[] = [];
  let ia = 0;
  for (const part of parts) {
    if (part.type === 'equal') {
      ia += part.value.length;
    } else if (part.type === 'delete') {
      // Merge a delete run with a directly following insert run into one seg.
      const delCount = part.value.length;
      segs.push({ index: ia, delCount, insert: '' });
      ia += delCount;
    } else {
      const last = segs[segs.length - 1];
      if (last && last.delCount > 0 && last.insert === '') {
        last.insert = part.value.join('');
      } else {
        segs.push({ index: ia, delCount: 0, insert: part.value.join('') });
      }
    }
  }

  const all: Op[] = [];
  for (const seg of segs.reverse()) {
    all.push(...currentDoc.edit(clientId, seg.index, seg.delCount, seg.insert));
  }
  return all;
}

export function createVersion(
  history: VersionHistory,
  kind: VersionKind,
  name: string | null,
  now: number,
  basedOn: string | null = null,
): VersionMeta {
  const meta: VersionMeta = {
    id: `v_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    name,
    createdAt: now,
    opOffset: history.ops.length,
    basedOn,
  };
  history.versions.push(meta);
  return meta;
}
