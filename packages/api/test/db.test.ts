import { describe, expect, it } from 'vitest';
import pg from 'pg';

// Importing the module registers the global int8 type parser as a side effect.
// Constructing a Pool does not open a connection, so no Postgres is required.
import { parseInt8 } from '../src/db.js';

// Mirrors the frontend formatters in VersionHistory.tsx / CommentPanel.tsx:
//   const fmt = (ts: number) => new Date(ts).toLocaleString('zh-CN', { hour12: false });
const rendersAs = (ts: unknown): string =>
  new Date(ts as number).toLocaleString('zh-CN', { hour12: false });

describe('BIGINT timestamp decoding (Invalid Date regression)', () => {
  it('returns a finite number instead of the node-postgres default string', () => {
    const fromWire: string = String(Date.now()); // int8 arrives as decimal text
    const decoded = parseInt8(fromWire);
    expect(typeof decoded).toBe('number');
    expect(Number.isSafeInteger(decoded)).toBe(true);
    expect(decoded).toBe(Number(fromWire));
  });

  it('is the parser node-postgres actually uses for int8 (OID 20)', () => {
    const parser = pg.types.getTypeParser(pg.types.builtins.INT8);
    const ms = Date.now();
    expect(parser(String(ms))).toBe(ms);
    // Counters stored in the same int8 affinity must stay numeric too.
    expect(parser('42')).toBe(42);
    expect(parser('0')).toBe(0);
  });

  it('renders a valid local datetime after a row is re-read from Postgres', () => {
    // The exact re-read path that used to show "Invalid Date":
    // raw int8 text -> registered parser -> API value -> browser new Date()
    const createdFromDb = pg.types.getTypeParser(20)(String(Date.now()));
    const shown = rendersAs(createdFromDb);
    expect(Number.isNaN(new Date(createdFromDb as number).getTime())).toBe(false);
    expect(shown).not.toBe('Invalid Date');
    expect(shown).not.toContain('Invalid');
  });

  it('documents why the old string payload was unrenderable', () => {
    // Guard that pins the mechanism: had int8 stayed a string, the browser
    // `new Date(<numeric string>)` path is what produced "Invalid Date".
    const legacy = String(Date.now());
    expect(typeof legacy).toBe('string');
    expect(Number.isNaN(new Date(legacy).getTime())).toBe(true);
  });
});
