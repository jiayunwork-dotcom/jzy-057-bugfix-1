import { CrdtDoc, resolveAnchor, type Op } from '@collabmd/core';
import { repo, type CommentRow } from '../repo.js';
import { config } from '../config.js';

type Listener = (event: RoomEvent) => void;

export type RoomEvent =
  | { type: 'ops'; ops: Op[]; author: string; fromVersion: number }
  | { type: 'anchors' };

/**
 * In-memory authority for one open document: the converged CRDT replica,
 * comment anchor tracking and auto-version timing. Rooms are created lazily
 * when the first socket/REST call touches the doc and cached by the registry.
 */
export class DocumentRoom {
  readonly doc = new CrdtDoc();
  private ops: Op[] = [];
  private dirty = false;
  private quietTimer: NodeJS.Timeout | null = null;
  private listeners = new Set<Listener>();

  private constructor(readonly docId: string) {}

  static async load(docId: string): Promise<DocumentRoom> {
    const room = new DocumentRoom(docId);
    room.ops = await repo.loadOps(docId);
    for (const op of room.ops) room.doc.integrate(op);
    return room;
  }

  text(): string {
    return this.doc.text();
  }

  opCount(): number {
    return this.ops.length;
  }

  allOps(): Op[] {
    return this.ops;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(ev: RoomEvent): void {
    for (const fn of this.listeners) fn(ev);
  }

  /**
   * Authoritatively integrate collaborator ops. New ops are deduped (reconnects
   * resend history); only genuinely novel ops are persisted/broadcast. Returns
   * the accepted ops in convergence order and the log version they extend.
   */
  async ingest(incoming: Op[], author: string): Promise<{ accepted: Op[]; fromVersion: number }> {
    const before = this.ops.length;
    const accepted: Op[] = [];
    for (const op of incoming) {
      if (this.doc.has(op)) continue;
      this.doc.integrate(op);
      this.ops.push(op);
      accepted.push(op);
    }
    if (accepted.length === 0) return { accepted, fromVersion: before };

    // In-memory log length is also the next dense Postgres seq.
    await repo.appendOps(this.docId, before, accepted, author);
    this.dirty = true;
    this.emit({ type: 'ops', ops: accepted, author, fromVersion: before });
    await this.reanchorComments();
    this.scheduleAutoVersion();
    return { accepted, fromVersion: before };
  }

  /**
   * Append ops produced server-side (rollback). These bypass dedup by design
   * and carry the system author.
   */
  async appendSystemOps(ops: Op[], author: string): Promise<void> {
    const startSeq = this.ops.length;
    for (const op of ops) {
      this.doc.integrate(op);
      this.ops.push(op);
    }
    await repo.appendOps(this.docId, startSeq, ops, author);
    this.dirty = true;
    await this.reanchorComments();
    this.emit({ type: 'ops', ops, author, fromVersion: startSeq });
  }

  /** Re-run every comment anchor over the new text and persist movements. */
  async reanchorComments(): Promise<void> {
    const comments = await repo.listComments(this.docId);
    if (comments.length === 0) return;
    const text = this.text();
    let changed = false;
    for (const c of comments) {
      const r = resolveAnchor(
        { quote: c.quote, index: c.anchor_idx, status: c.status },
        text,
      );
      if (r.index !== c.anchor_idx || r.status !== c.status) {
        await repo.updateCommentAnchor(c.id, r.index, r.status);
        changed = true;
      }
    }
    if (changed) this.emit({ type: 'anchors' });
  }

  private scheduleAutoVersion(): void {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => {
      void this.flushAutoVersion();
    }, config.autoVersionQuietMs);
  }

  /** Called on quiet timeout; write an auto version as soon as the minimum
   *  interval since the previous version has elapsed (re-arming otherwise). */
  private async flushAutoVersion(): Promise<void> {
    if (!this.dirty) return;
    const versions = await repo.listVersions(this.docId);
    const last = versions[versions.length - 1];
    const now = Date.now();
    const wait = last
      ? Math.max(0, config.autoVersionIntervalMs - (now - last.created_at))
      : 0;
    if (wait > 0) {
      this.quietTimer = setTimeout(() => void this.flushAutoVersion(), wait);
      return;
    }
    await writeAutoVersion(this);
  }

  async flushNow(): Promise<void> {
    if (this.quietTimer) {
      clearTimeout(this.quietTimer);
      this.quietTimer = null;
    }
    if (this.dirty) await writeAutoVersion(this);
  }

  markClean(): void {
    this.dirty = false;
  }
}

/** Registry of currently loaded rooms. */
const rooms = new Map<string, Promise<DocumentRoom>>();

export async function getRoom(docId: string): Promise<DocumentRoom> {
  const existing = rooms.get(docId);
  if (existing) return existing;
  const loading = DocumentRoom.load(docId);
  rooms.set(docId, loading);
  return loading;
}

/** Persist an auto checkpoint at the current op log offset. */
async function writeAutoVersion(room: DocumentRoom): Promise<void> {
  const versions = await repo.listVersions(room.docId);
  const last = versions[versions.length - 1];
  const offset = room.opCount();
  if (last && last.op_offset >= offset) {
    room.markClean();
    return;
  }
  const now = Date.now();
  await repo.insertVersion({
    id: `v_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    doc_id: room.docId,
    kind: 'auto',
    name: null,
    op_offset: offset,
    based_on: null,
    author: 'system',
    created_at: now,
  });
  room.markClean();
}
