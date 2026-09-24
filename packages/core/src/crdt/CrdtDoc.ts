import {
  compareId,
  idKey,
  opKey,
  type Id,
  type InsertOp,
  type Op,
} from './types.js';

/**
 * A character node. Tombstoned characters remain in the tree
 * (logical delete) so concurrent insertions keep a valid anchor.
 */
interface Node {
  id: Id;
  text: string;
  deleted: boolean;
  parent: Id | null;
  /** Younger siblings first, in descending id order. */
  children: Node[];
}

export interface Snapshot {
  clock: number;
  seen: string[];
  nodes: Array<{
    id: Id;
    after: Id | null;
    text: string;
    deleted: boolean;
  }>;
}

/**
 * An RGA CRDT replica. The merge function (`integrate`) is intentionally
 * transport-agnostic: feeding the same set of ops in any order to any replica
 * converges to the identical character sequence.
 */
export class CrdtDoc {
  /** lamport clock observed by this replica */
  clock = 0;
  private readonly root: Node = {
    id: [0, ''],
    text: '',
    deleted: false,
    parent: null,
    children: [],
  };
  private readonly nodes = new Map<string, Node>();
  private readonly seen = new Set<string>();
  /** ops whose anchor/target is not yet integrated */
  private readonly pending = new Map<string, Op>();

  has(op: Op): boolean {
    return this.seen.has(opKey(op));
  }

  /** Merge a remote/local op. Returns false iff the op is buffered pending. */
  integrate(op: Op): boolean {
    const key = opKey(op);
    if (this.seen.has(key)) return true;

    if (op.type === 'insert') {
      if (op.after !== null && !this.nodes.has(idKey(op.after))) {
        this.pending.set(key, op);
        return false;
      }
      this.integrateInsert(op);
    } else {
      const node = this.nodes.get(idKey(op.target));
      if (!node) {
        this.pending.set(key, op);
        return false;
      }
      node.deleted = true;
    }

    this.seen.add(key);
    this.clock = Math.max(this.clock, op.id[0]);
    this.flushPending();
    return true;
  }

  private integrateInsert(op: InsertOp): void {
    const node: Node = {
      id: op.id,
      text: op.text,
      deleted: false,
      parent: op.after,
      children: [],
    };
    const parent =
      op.after === null ? this.root : this.nodes.get(idKey(op.after))!;
    // Descending id order: newest concurrent insert wins the leftmost slot,
    // older insertions shift right — identical result on every replica.
    let i = 0;
    while (
      i < parent.children.length &&
      compareId(parent.children[i].id, op.id) > 0
    ) {
      i++;
    }
    parent.children.splice(i, 0, node);
    this.nodes.set(idKey(op.id), node);
  }

  private flushPending(): void {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [key, op] of this.pending) {
        const ready =
          op.type === 'insert'
            ? op.after === null || this.nodes.has(idKey(op.after))
            : this.nodes.has(idKey(op.target));
        if (!ready || this.seen.has(key)) continue;
        this.pending.delete(key);
        if (op.type === 'insert') this.integrateInsert(op);
        else this.nodes.get(idKey(op.target))!.deleted = true;
        this.seen.add(key);
        this.clock = Math.max(this.clock, op.id[0]);
        progressed = true;
      }
    }
  }

  /** Visible (non-tombstoned) characters in convergence order. */
  text(): string {
    let out = '';
    const walk = (node: Node): void => {
      if (node !== this.root && !node.deleted) out += node.text;
      for (const child of node.children) walk(child);
    };
    walk(this.root);
    return out;
  }

  /** Ids of every visible character, aligned 1:1 with `text()`. */
  visibleIds(): Id[] {
    const out: Id[] = [];
    const walk = (node: Node): void => {
      if (node !== this.root && !node.deleted) out.push(node.id);
      for (const child of node.children) walk(child);
    };
    walk(this.root);
    return out;
  }

  findVisible(id: Id): number {
    return this.visibleIds().findIndex((v) => idKey(v) === idKey(id));
  }

  isDeleted(id: Id): boolean {
    return this.nodes.get(idKey(id))?.deleted ?? false;
  }

  /**
   * Generate local edit ops and integrate them immediately.
   * @param index visible-text index of the start of the replacement
   * @param delCount number of visible characters removed
   * @param inserted replacement text
   */
  edit(clientId: string, index: number, delCount: number, inserted: string): Op[] {
    const ids = this.visibleIds();
    const ops: Op[] = [];

    for (let k = 0; k < delCount; k++) {
      this.clock += 1;
      const id: Id = [this.clock, clientId];
      const target = ids[index + k];
      const op: Op = { type: 'delete', id, target };
      ops.push(op);
      this.integrate(op);
    }

    // Each char of the run is anchored on the previous char, so the run
    // keeps typing order; only the first char uses the caller's anchor.
    let after: Id | null = index === 0 ? null : ids[index - 1];
    for (const ch of inserted) {
      this.clock += 1;
      const op: Op = {
        type: 'insert',
        id: [this.clock, clientId],
        after,
        text: ch,
      };
      ops.push(op);
      this.integrate(op);
      after = op.id;
    }
    return ops;
  }

  /** Current lamport clock value (for client acks/sync). */
  getClock(): number {
    return this.clock;
  }

  /** Every integrated op (insert/tombstone), compact persistence form. */
  toOps(): Op[] {
    const ops: Op[] = [];
    for (const node of this.nodes.values()) {
      ops.push({ type: 'insert', id: node.id, after: node.parent, text: node.text });
      if (node.deleted) {
        // Deletion op id is not preserved on the node; reconstruct a stable
        // synthetic id solely for snapshot re-integration. Live ops carry
        // their own ids; see loadOps for the dedup treatment.
        ops.push({
          type: 'delete',
          id: [-node.id[0], node.id[1]],
          target: node.id,
        });
      }
    }
    return ops;
  }

  snapshot(): Snapshot {
    const nodes: Snapshot['nodes'] = [];
    for (const node of this.nodes.values()) {
      nodes.push({ id: node.id, after: node.parent, text: node.text, deleted: node.deleted });
    }
    return { clock: this.clock, seen: [...this.seen], nodes };
  }

  loadSnapshot(s: Snapshot): void {
    // Rebuild by integrating inserts first (unordered), then deletes.
    const inserts: Op[] = [];
    const deletes: Op[] = [];
    for (const n of s.nodes) {
      inserts.push({ type: 'insert', id: n.id, after: n.after, text: n.text });
      if (n.deleted) {
        deletes.push({ type: 'delete', id: [-n.id[0], n.id[1]], target: n.id });
      }
    }
    // inserts may reference parents not yet seen; pending buffer handles it.
    for (const op of inserts) this.integrate(op);
    for (const op of deletes) this.integrate(op);
    for (const key of s.seen) this.seen.add(key);
    this.clock = Math.max(this.clock, s.clock);
  }
}

/** Apply an unordered/concurrent op set to a fresh replica. */
export function mergeOps(ops: Op[]): CrdtDoc {
  const doc = new CrdtDoc();
  for (const op of ops) doc.integrate(op);
  return doc;
}
