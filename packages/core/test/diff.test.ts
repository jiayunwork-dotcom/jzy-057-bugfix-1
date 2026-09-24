import { describe, expect, it } from 'vitest';
import { diffText, myers } from '../src/diff/index.js';

describe('diff kernel', () => {
  it('diffs inserted, deleted and modified lines', () => {
    const oldT = 'same\nold line\nremoved-only\nbetween\ntail';
    const newT = 'same\nnew line\nbetween\nadded-only\ntail';
    const rows = diffText(oldT, newT);

    const types = rows.map((r) => r.type);
    expect(types).toContain('equal');
    expect(types).toContain('modify'); // old line -> new line
    expect(types).toContain('delete'); // removed
    expect(types).toContain('insert'); // added

    const modified = rows.find((r) => r.type === 'modify')!;
    const oldInline = modified.oldParts!.map((p) =>
      p.type === 'delete' ? `[-${p.value.join('')}-]` : p.value.join(''),
    ).join('');
    const newInline = modified.newParts!.map((p) =>
      p.type === 'insert' ? `[+${p.value.join('')}+]` : p.value.join(''),
    ).join('');
    expect(oldInline).toContain('[-old-]');
    expect(newInline).toContain('[+new+]');
  });

  it('char-level myers aligns common prefix/suffix', () => {
    const parts = myers(['h', 'e', 'l', 'l', 'o'], ['h', 'a', 'l', 'l', 'o']);
    const dels = parts.filter((p) => p.type === 'delete').flatMap((p) => p.value);
    const ins = parts.filter((p) => p.type === 'insert').flatMap((p) => p.value);
    const eq = parts.filter((p) => p.type === 'equal').flatMap((p) => p.value);
    expect(dels).toEqual(['e']);
    expect(ins).toEqual(['a']);
    expect(eq).toEqual(['h', 'l', 'l', 'o']);
  });
});
