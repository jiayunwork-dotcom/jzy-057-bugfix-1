import { describe, expect, it } from 'vitest';
import { CrdtDoc } from '../src/crdt/CrdtDoc.js';
import {
  createVersion,
  diffVersions,
  materialize,
  materializeHead,
  rollbackOps,
  type VersionHistory,
} from '../src/version/index.js';

function newHistory(): VersionHistory {
  return { versions: [], ops: [] };
}

describe('version kernel', () => {
  it('accumulates incremental versions and names snapshots', () => {
    const h = newHistory();
    const doc = new CrdtDoc();

    h.ops.push(...doc.edit('alice', 0, 0, 'v1 text'));
    const v1 = createVersion(h, 'auto', null, 1000);

    h.ops.push(...doc.edit('alice', doc.text().length, 0, ' + v2'));
    const snap = createVersion(h, 'snapshot', '评审基线', 2000);

    h.ops.push(...doc.edit('alice', 0, 1, 'V'));
    const v3 = createVersion(h, 'auto', null, 3000);

    expect(v1.opOffset).toBeGreaterThan(0);
    expect(snap.name).toBe('评审基线');
    expect(v3.opOffset).toBeGreaterThan(snap.opOffset);
    // incremental: later versions strictly cover more of the shared log
    expect(materialize(h, v1.id).text).toBe('v1 text');
    expect(materialize(h, snap.id).text).toBe('v1 text + v2');
    expect(materializeHead(h)).toBe('V1 text + v2');
  });

  it('diffs two versions with line-level changes', () => {
    const h = newHistory();
    const doc = new CrdtDoc();
    h.ops.push(...doc.edit('a', 0, 0, 'line one\nline two'));
    const v1 = createVersion(h, 'snapshot', 'a', 1);
    h.ops.push(...doc.edit('a', doc.text().indexOf('two'), 3, 'TWO!'));
    const v2 = createVersion(h, 'snapshot', 'b', 2);

    const rows = diffVersions(h, v1.id, v2.id);
    expect(rows.some((r) => r.type === 'modify')).toBe(true);
    const mod = rows.find((r) => r.type === 'modify')!;
    expect(mod.text).toBe('line TWO!');
  });

  it('rolls back to a snapshot as a NEW version, keeping intermediate edits', () => {
    const h = newHistory();
    const doc = new CrdtDoc();

    h.ops.push(...doc.edit('alice', 0, 0, 'original section\nkeep'));
    const target = createVersion(h, 'snapshot', 'known-good', 100);

    h.ops.push(...doc.edit('bob', 0, 0, 'BOTCHED '));
    h.ops.push(...doc.edit('bob', doc.text().length, 0, '\nextra'));
    const mid = createVersion(h, 'auto', null, 200);
    expect(materialize(h, mid.id).text).toBe('BOTCHED original section\nkeep\nextra');

    // Roll back to known-good text.
    const targetText = materialize(h, target.id).text;
    const ops = rollbackOps(doc, targetText, 'alice');
    h.ops.push(...ops);
    const rb = createVersion(h, 'rollback', '回滚到 known-good', 300, target.id);

    expect(rb.kind).toBe('rollback');
    expect(rb.basedOn).toBe(target.id);
    expect(materialize(h, rb.id).text).toBe('original section\nkeep');

    // Intermediate work is NOT lost — it remains reachable at its own version.
    expect(materialize(h, mid.id).text).toBe('BOTCHED original section\nkeep\nextra');
    // And head now equals the restored content.
    expect(materializeHead(h)).toBe('original section\nkeep');
  });
});
