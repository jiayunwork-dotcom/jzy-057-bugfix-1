/**
 * Comment anchoring.
 *
 * A comment is created against an exact quote (the selected text) plus the
 * character index where the selection was. As the document is edited the
 * anchor must:
 *
 *  - stay on the original text when only surrounding text changed (it slides);
 *  - follow the closest match when the quote was partially edited;
 *  - be marked `lost` (never deleted) when the quote was removed wholesale.
 *
 * Resolutions are intentionally pure: given the last known state and the new
 * text they return the new state. Persistence of that state is the caller's
 * job.
 */

export type AnchorStatus = 'anchored' | 'lost';

export interface Anchor {
  /** Text the reviewer originally selected. */
  quote: string;
  /** Start index in the text at creation / last successful resolution. */
  index: number;
  status: AnchorStatus;
}

export interface ResolvedAnchor extends Anchor {
  /** Half-open character range of the quote in the current text. */
  end: number;
}

/** Tokenize into word chunks and whitespace/punctuation chunks. */
function tokenize(s: string): string[] {
  return s.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}\s]+/gu) ?? [];
}

/** Length of the longest common subsequence of tokens. */
function tokenLcs(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  let cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1] + 1
          : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Character-level LCS ratio for CJK/whitespace-heavy quotes. */
function charSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  let cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1] + 1
          : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  const lcs = prev[b.length];
  return (2 * lcs) / (a.length + b.length);
}

/** 0..1 similarity, combining token-LCS (edit distance flavour) and char ratio. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const ta = tokenize(a);
  const tb = tokenize(b);
  const lcs = tokenLcs(ta, tb);
  const tokenScore = (2 * lcs) / (ta.length + tb.length);
  return Math.max(tokenScore, charSimilarity(a, b));
}

const SEARCH_WINDOW = 400; // chars either side of the old position
const MIN_SCORE = 0.6; // a window must share at least this much of the quote

/**
 * Resolve one anchor against the current document text.
 *
 * @returns the resolved range, or a lost anchor carrying the quote forward.
 */
export function resolveAnchor(anchor: Anchor, text: string): ResolvedAnchor {
  const q = anchor.quote;
  if (q.length === 0) {
    return { ...anchor, status: 'lost', end: anchor.index };
  }

  // 1. Exact match at the same index — nothing moved.
  if (text.substr(anchor.index, q.length) === q) {
    return { ...anchor, status: 'anchored', end: anchor.index + q.length };
  }

  // 2. Any exact quote match: prefer the one nearest the old index.
  const exact = nearestOccurrence(text, q, anchor.index);
  if (exact >= 0) {
    return { ...anchor, index: exact, status: 'anchored', end: exact + q.length };
  }

  // 3. A previously lost anchor re-resolves if the quote reappears exactly
  //    (handled above); otherwise it stays lost.
  if (anchor.status === 'lost') {
    return { ...anchor, end: anchor.index };
  }

  // 4. Partial edit: scan windows near the old index for the closest match.
  const from = Math.max(0, anchor.index - SEARCH_WINDOW);
  const to = Math.min(text.length, anchor.index + SEARCH_WINDOW);
  let best = -1;
  let bestLen = q.length;
  let bestScore = MIN_SCORE;
  for (let i = from; i < to; i++) {
    for (const len of [q.length, q.length - 1, q.length + 1, q.length - 2]) {
      if (len <= 0 || i + len > text.length) continue;
      const score = similarity(q, text.substr(i, len));
      if (score > bestScore) {
        bestScore = score;
        best = i;
        bestLen = len;
      }
    }
  }

  if (best >= 0) {
    const end = Math.min(text.length, best + bestLen);
    return { ...anchor, index: best, status: 'anchored', end };
  }

  // 5. Quote was removed wholesale — keep the comment, flag the lost anchor.
  return { ...anchor, status: 'lost', end: anchor.index };
}

function nearestOccurrence(text: string, q: string, near: number): number {
  let best = -1;
  let bestDist = Infinity;
  let from = 0;
  while (from <= text.length - q.length) {
    const at = text.indexOf(q, from);
    if (at < 0) break;
    const dist = Math.abs(at - near);
    if (dist < bestDist) {
      bestDist = dist;
      best = at;
    }
    from = at + 1;
  }
  return best;
}

/** Resolve a batch, e.g. after one collaborative edit. */
export function resolveAnchors(anchors: Anchor[], text: string): ResolvedAnchor[] {
  return anchors.map((a) => resolveAnchor(a, text));
}
