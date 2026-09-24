/**
 * CRDT operation wire format (RGA — Replicated Growable Array).
 *
 * Every character carries a globally unique identifier `[lamportClock, clientId]`.
 * `after` is the unique id of the character immediately before it at the moment
 * of insertion (null = document start). Concurrent insertions that share the
 * same anchor are ordered by their identifier (higher clock first, clientId as
 * tie breaker), which gives every replica the same deterministic final order.
 *
 * Deletion is logical: a delete op only flips a tombstone flag on the target
 * character. The node stays in the tree so concurrent insertions anchored on or
 * after it never lose their anchor.
 */

export type Id = [clock: number, client: string];

export interface InsertOp {
  type: 'insert';
  /** Unique id of the inserted character, also the op's dedup key. */
  id: Id;
  /** Character id this insertion hangs under (null = root). */
  after: Id | null;
  /** Exactly one character. */
  text: string;
}

export interface DeleteOp {
  type: 'delete';
  /** Unique id of the deletion operation, used for dedup. */
  id: Id;
  /** Character id being tombstoned. */
  target: Id;
}

export type Op = InsertOp | DeleteOp;

export const idKey = (id: Id): string => `${id[0]}:${id[1]}`;

export const opKey = (op: Op): string =>
  op.type === 'insert' ? `i:${idKey(op.id)}` : `d:${idKey(op.id)}`;

/**
 * Stable total order on character ids.
 * Returns positive when a sorts *before* b in RGA order (newest first).
 */
export function compareId(a: Id, b: Id): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
}
