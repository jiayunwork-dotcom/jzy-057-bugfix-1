/**
 * Myers diff over generic token arrays. Returns a shortest-edit-script of
 * token-level ops. Used once at line level and again (on word/char tokens)
 * inside modified line pairs for intra-line highlighting.
 */

export type DiffType = 'equal' | 'insert' | 'delete';

export interface DiffPart<T> {
  type: DiffType;
  value: T[];
}

/** O(ND) Myers shortest edit script (classic snake algorithm). */
export function myers<T>(
  a: T[],
  b: T[],
  eq: (x: T, y: T) => boolean = (x, y) => x === y,
): DiffPart<T>[] {
  const n = a.length;
  const m = b.length;

  // Special cases.
  if (n === 0) return m === 0 ? [] : [{ type: 'insert', value: [...b] }];
  if (m === 0) return [{ type: 'delete', value: [...a] }];

  const maxD = n + m;
  // V maps diagonal k -> furthest x reached. Missing keys read as -1
  // (unreachable); the k=1 sentinel seeds the very first move.
  let V = new Map<number, number>([[1, 0]]);
  const get = (map: Map<number, number>, k: number): number =>
    map.has(k) ? map.get(k)! : -1;
  const trace: Array<Map<number, number>> = [];

  let endD = 0;
  let done = false;
  for (let d = 0; d <= maxD && !done; d++) {
    const VNext = new Map<number, number>();
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (d === 0) {
        x = 0;
      } else if (k === -d || (k !== d && get(V, k - 1) < get(V, k + 1))) {
        x = get(V, k + 1); // move down = insert
      } else {
        x = get(V, k - 1) + 1; // move right = delete
      }
      let y = x - k;
      while (x < n && y < m && eq(a[x], b[y])) {
        x++;
        y++;
      }
      VNext.set(k, x);
      if (x >= n && y >= m) {
        endD = d;
        done = true;
      }
    }
    trace.push(new Map(VNext)); // V after d edits
    V = VNext;
  }

  // Backtrack from (n, m). trace[d-1] is V after d-1 edits (pre-edit-d state).
  const ses: DiffType[] = [];
  let x = n;
  let y = m;
  for (let d = endD; d > 0; d--) {
    const Vp = trace[d - 1];
    const k = x - y;
    const goInsert =
      k === -d || (k !== d && get(Vp, k - 1) < get(Vp, k + 1));
    const prevK = goInsert ? k + 1 : k - 1;
    // Vp[k±1] is the furthest point *before* the snake; the single edit move
    // and following snake separate prev from current.
    const prevX = get(Vp, prevK);
    const prevY = prevX - prevK;
    // Right-move (delete) advances x by one; down-move (insert) advances y.
    const editX = goInsert ? prevX : prevX + 1;
    const editY = goInsert ? prevY + 1 : prevY;
    while (x > editX && y > editY) {
      ses.push('equal');
      x--;
      y--;
    }
    if (goInsert) {
      ses.push('insert');
      y--;
    } else {
      ses.push('delete');
      x--;
    }
  }
  while (x > 0 && y > 0) {
    ses.push('equal');
    x--;
    y--;
  }
  while (y > 0) {
    ses.push('insert');
    y--;
  }
  while (x > 0) {
    ses.push('delete');
    x--;
  }
  ses.reverse();

  const parts: DiffPart<T>[] = [];
  let ia = 0;
  let ib = 0;
  const push = (type: DiffType, val: T): void => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.value.push(val);
    else parts.push({ type, value: [val] });
  };
  for (const type of ses) {
    if (type === 'equal') {
      push('equal', a[ia++]);
      ib++;
    } else if (type === 'delete') {
      push('delete', a[ia++]);
    } else {
      push('insert', b[ib++]);
    }
  }
  return parts;
}

/** Diff tokens of a single line: CJK chars, words, whitespace, punctuation. */
export function tokenizeLine(line: string): string[] {
  return line.match(/[\p{Script=Han}]|[A-Za-z0-9_]+|\s+|[^\s\p{L}\p{N}]/gu) ?? [];
}

export type RowType = 'equal' | 'insert' | 'delete' | 'modify';

export interface LineDiffRow {
  type: RowType;
  oldLine: number | null;
  newLine: number | null;
  text: string;
  /** intra-line parts (modify rows get both; insert/delete get their side) */
  oldParts?: DiffPart<string>[];
  newParts?: DiffPart<string>[];
}

/**
 * Line-level diff of two texts. Adjacent delete+insert blocks are paired
 * row-by-row into `modify` rows carrying word/char-level parts; surplus rows
 * remain pure inserts/deletes.
 */
export function diffText(oldText: string, newText: string): LineDiffRow[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const parts = myers(a, b);

  const rows: LineDiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;

  const equalRow = (line: string): void => {
    oldNo++;
    newNo++;
    rows.push({ type: 'equal', oldLine: oldNo, newLine: newNo, text: line });
  };
  const deleteRow = (line: string): void => {
    oldNo++;
    rows.push({
      type: 'delete',
      oldLine: oldNo,
      newLine: null,
      text: line,
      oldParts: [{ type: 'delete', value: tokenizeLine(line) }],
    });
  };
  const insertRow = (line: string): void => {
    newNo++;
    rows.push({
      type: 'insert',
      oldLine: null,
      newLine: newNo,
      text: line,
      newParts: [{ type: 'insert', value: tokenizeLine(line) }],
    });
  };
  const modifyRow = (oldLine: string, newLine: string): void => {
    oldNo++;
    newNo++;
    const inline = myers(tokenizeLine(oldLine), tokenizeLine(newLine));
    rows.push({
      type: 'modify',
      oldLine: oldNo,
      newLine: newNo,
      text: newLine,
      oldParts: inline.filter((p) => p.type !== 'insert'),
      newParts: inline.filter((p) => p.type !== 'delete'),
    });
  };

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.type === 'equal') {
      for (const line of part.value) equalRow(line);
    } else if (part.type === 'delete') {
      const next = parts[i + 1];
      if (next && next.type === 'insert') {
        const del = part.value;
        const ins = next.value;
        const paired = Math.min(del.length, ins.length);
        for (let k = 0; k < paired; k++) modifyRow(del[k], ins[k]);
        for (let k = paired; k < del.length; k++) deleteRow(del[k]);
        for (let k = paired; k < ins.length; k++) insertRow(ins[k]);
        i++;
      } else {
        for (const line of part.value) deleteRow(line);
      }
    } else {
      for (const line of part.value) insertRow(line);
    }
  }
  return rows;
}
