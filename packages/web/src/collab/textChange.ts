export interface TextChange {
  index: number;
  delCount: number;
  inserted: string;
}

/**
 * Reduce an arbitrary old->new text replacement to (commonPrefix, run,
 * commonSuffix). Works for ordinary typing/deletion/IME replacements.
 */
export function diffTextChange(oldText: string, newText: string): TextChange {
  let start = 0;
  const maxStart = Math.min(oldText.length, newText.length);
  while (start < maxStart && oldText[start] === newText[start]) start++;

  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return {
    index: start,
    delCount: oldEnd - start,
    inserted: newText.slice(start, newEnd),
  };
}
