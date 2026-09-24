import { describe, expect, it } from 'vitest';
import { CrdtDoc } from '../src/crdt/CrdtDoc.js';
import type { Op } from '../src/crdt/types.js';

/** Replicate a log to a fresh replica applying ops in the given order. */
function replay(order: Op[]): string {
  const doc = new CrdtDoc();
  for (const op of order) doc.integrate(op);
  return doc.text();
}

function shuffle<T>(items: T[], seed: number): T[] {
  const a = [...items];
  let s = seed;
  const rand = (): number => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe('CRDT convergence', () => {
  it('converges character-for-character when ops are applied in any order', () => {
    // Shared base "abc" whose middle char id we reuse as a concurrent anchor.
    const base = new CrdtDoc();
    const baseOps = base.edit('server', 0, 0, 'abc');
    const anchorB = base.visibleIds()[1]; // 'b'

    // Three concurrent inserts with the same anchor, distinct ids.
    const insX: Op = { type: 'insert', id: [10, 'alice'], after: anchorB, text: 'X' };
    const insY: Op = { type: 'insert', id: [20, 'bob'], after: anchorB, text: 'Y' };
    const insZ: Op = { type: 'insert', id: [15, 'carol'], after: anchorB, text: 'Z' };
    const all: Op[] = [...baseOps, insX, insY, insZ];

    // Youngest id sits nearest the anchor: ab Y Z X c, regardless of delivery.
    const reference = replay(all);
    expect(reference).toBe('abYZXc');
    for (let seed = 1; seed <= 80; seed++) {
      expect(replay(shuffle(all, seed))).toBe(reference);
    }
  });

  it('handles concurrent insert and delete at the same position', () => {
    const base = new CrdtDoc();
    base.edit('s', 0, 0, 'ab');
    const baseOps = base.toOps().filter((o) => o.type === 'insert');

    const a = new CrdtDoc();
    baseOps.forEach((o) => a.integrate(o));
    const b = new CrdtDoc();
    baseOps.forEach((o) => b.integrate(o));

    // A inserts X between a and b; B deletes b — concurrently, no causal link.
    const ins = a.edit('alice', 1, 0, 'X');
    const del = b.edit('bob', 1, 1, ''); // deletes visible char at index 1 = 'b'

    const mergedA = new CrdtDoc();
    [...baseOps, ...ins, ...del].forEach((o) => mergedA.integrate(o));
    const mergedB = new CrdtDoc();
    [...shuffle([...ins, ...del], 7), ...baseOps].forEach((o) =>
      mergedB.integrate(o),
    );

    for (const doc of [mergedA, mergedB]) {
      const text = doc.text();
      expect(text).not.toContain('b'); // deleted char never resurfaces
      expect(text).toContain('X'); // inserted char survives
      expect(text).toBe('aX'); // X has a deterministic landing position
    }
  });

  it('merges offline edits automatically without losing either side', () => {
    // Shared base.
    const server = new CrdtDoc();
    server.edit('s', 0, 0, 'Hello world');
    const baseOps = server.toOps().filter((o) => o.type === 'insert');

    // Alice goes offline and keeps editing her replica.
    const alice = new CrdtDoc();
    baseOps.forEach((o) => alice.integrate(o));
    const offlineA = [
      ...alice.edit('alice', 5, 0, ', CRDT'),
      ...alice.edit('alice', 0, 0, '>> '),
      ...alice.edit('alice', alice.text().length - 1, 1, 'D'), // world -> worlD
    ];

    // Meanwhile Bob edits live on the server copy.
    const online = new CrdtDoc();
    baseOps.forEach((o) => online.integrate(o));
    const onlineB = [
      ...online.edit('bob', 11, 0, '!'),
      ...online.edit('bob', 0, 1, 'h'), // Hello -> hello
    ];

    // Alice reconnects: her buffered ops merge with everything she missed.
    const reconnected = new CrdtDoc();
    for (const op of baseOps) reconnected.integrate(op);
    for (const op of onlineB) reconnected.integrate(op);
    for (const op of offlineA) reconnected.integrate(op);

    const text = reconnected.text();
    // Nothing from either side is lost.
    expect(text).toContain('CRDT'); // alice offline insert
    expect(text).toContain('>>'); // alice offline prefix
    expect(text).toContain('worlD'); // alice offline replace
    expect(text).toContain('!'); // bob online insert
    expect(text.startsWith('>> h')).toBe(true); // both starts merged deterministically

    // Server ingesting the offline buffer converges to the exact same string.
    const serverAfter = new CrdtDoc();
    for (const op of baseOps) serverAfter.integrate(op);
    for (const op of onlineB) serverAfter.integrate(op);
    for (const op of [...offlineA].reverse()) serverAfter.integrate(op);
    expect(serverAfter.text()).toBe(text);
  });

  it('is idempotent under duplicate op delivery', () => {
    const doc = new CrdtDoc();
    const ops = doc.edit('a', 0, 0, 'abc');
    ops.forEach((o) => doc.integrate(o));
    ops.forEach((o) => doc.integrate(o));
    expect(doc.text()).toBe('abc');
  });

  it('buffers ops whose anchor is missing and integrates them on arrival', () => {
    const doc = new CrdtDoc();
    const first = doc.edit('a', 0, 0, 'x');
    const insert = first.find((o) => o.type === 'insert')!;
    const other = new CrdtDoc(); // fresh replica that has seen nothing yet
    const follow: Op = {
      type: 'insert',
      id: [2, 'b'],
      after: insert.id,
      text: 'y',
    };
    // follow arrives before its anchor op
    expect(other.integrate(follow)).toBe(false);
    expect(other.text()).toBe('');
    other.integrate(insert);
    expect(other.text()).toBe('xy');
  });
});
