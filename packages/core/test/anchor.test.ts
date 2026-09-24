import { describe, expect, it } from 'vitest';
import { resolveAnchor, similarity, type Anchor } from '../src/anchor/index.js';

const anchored = (quote: string, index: number): Anchor => ({
  quote,
  index,
  status: 'anchored',
});

describe('comment anchoring', () => {
  it('covers the original quote after characters are inserted before it (no drift)', () => {
    const before = 'Title\nThe quick brown fox.\nFooter';
    const index = before.indexOf('quick brown');
    const a = anchored('quick brown', index);

    const after = 'Title\nThe very quick brown fox.\nFooter';
    const r = resolveAnchor(a, after);

    expect(r.status).toBe('anchored');
    expect(after.slice(r.index, r.end)).toBe('quick brown');
  });

  it('follows text that moved to a new position', () => {
    const before = '# Doc\nTODO: refactor this module\n';
    const a = anchored('TODO: refactor this module', before.indexOf('TODO'));
    const after =
      '# Doc\n\n> moved note\n\nTODO: refactor this module\nsee also\n';
    const r = resolveAnchor(a, after);
    expect(r.status).toBe('anchored');
    expect(after.slice(r.index, r.end)).toBe('TODO: refactor this module');
  });

  it('follows the closest match when the quote is partially edited', () => {
    const before = 'The performace of the cache is poor.';
    const a = anchored('performace of the cache', before.indexOf('performace'));
    const after = 'The performance of the cache layer is poor.';
    const r = resolveAnchor(a, after);
    expect(r.status).toBe('anchored');
    const covered = after.slice(r.index, r.end);
    expect(covered).toContain('performance');
    expect(covered).toContain('cache');
  });

  it('marks the anchor lost (never dropping content) when fully deleted', () => {
    const before = 'keep me\ndelete this paragraph entirely\nend';
    const a = anchored('delete this paragraph entirely', before.indexOf('delete'));
    const after = 'keep me\nend';
    const r = resolveAnchor(a, after);
    expect(r.status).toBe('lost');
    expect(r.quote).toBe('delete this paragraph entirely');
  });

  it('re-resolves a lost anchor if the quote reappears later', () => {
    const before = 'abc NEEDLE xyz';
    const a = anchored('NEEDLE', 4);
    const lost = resolveAnchor(a, 'abc xyz');
    expect(lost.status).toBe('lost');
    const found = resolveAnchor(lost, 'abc xyz NEEDLE tail');
    expect(found.status).toBe('anchored');
    expect(found.index).toBe(8);
  });

  it('similarity scores 1 for identical and 0 for empty', () => {
    expect(similarity('same text', 'same text')).toBe(1);
    expect(similarity('', 'x')).toBe(0);
  });
});
