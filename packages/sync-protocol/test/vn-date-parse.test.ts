// packages/sync-protocol/test/vn-date-parse.test.ts
// RED spec (t65 Phase 6). The Vietnamese date FIELD needs a lossless bridge
// between what a dispatcher types and what the wire carries.
//
// WHY THIS LIVES IN THE CONTRACT AND NOT IN THE COMPONENT. The native
// input type=date is being replaced because its displayed format is owned by
// the browser locale and cannot be overridden from application code. The
// replacement must therefore do its own parsing -- but the ISO value it
// submits is consumed by ExportDateRangeSchema and by the create-order action,
// so the conversion is part of the wire contract, not a widget detail. Putting
// it here means the component, the server action and any future importer share
// one definition and one set of edge cases.
//
// STRICTNESS IS THE POINT. A dispatcher typing 31/02/2026 must be REJECTED,
// not silently rolled forward into 03/03. The JS Date constructor does exactly
// that silent rollover, so these tests pin round-trip verification: the parsed
// date is re-rendered and compared against the input, and a mismatch means the
// input named a day that does not exist.
import { describe, expect, it } from 'vitest';
import {
  parseVnDateToIso,
  isoToVnDate,
} from '../src/vn-date-format.js';

describe('parseVnDateToIso', () => {
  it('converts a typed Vietnamese date into the ISO wire value', () => {
    expect(parseVnDateToIso('19/07/2026')).toBe('2026-07-19');
  });

  it('accepts single-digit day and month input and pads it', () => {
    expect(parseVnDateToIso('5/3/2026')).toBe('2026-03-05');
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseVnDateToIso('  19/07/2026  ')).toBe('2026-07-19');
  });

  it('accepts a leap day in a leap year', () => {
    expect(parseVnDateToIso('29/02/2028')).toBe('2028-02-29');
  });

  it('rejects a leap day in a non-leap year rather than rolling it over', () => {
    expect(parseVnDateToIso('29/02/2027')).toBe(null);
  });

  it('rejects a day that does not exist in the month', () => {
    expect(parseVnDateToIso('31/02/2026')).toBe(null);
    expect(parseVnDateToIso('31/04/2026')).toBe(null);
  });

  it('rejects an out-of-range month', () => {
    expect(parseVnDateToIso('19/13/2026')).toBe(null);
    expect(parseVnDateToIso('19/00/2026')).toBe(null);
  });

  it('rejects a zero day', () => {
    expect(parseVnDateToIso('00/07/2026')).toBe(null);
  });

  it('rejects an incomplete or malformed entry', () => {
    expect(parseVnDateToIso('')).toBe(null);
    expect(parseVnDateToIso('19/07')).toBe(null);
    expect(parseVnDateToIso('19-07-2026')).toBe(null);
    expect(parseVnDateToIso('abc')).toBe(null);
  });

  it('rejects a two-digit year, which is ambiguous in an operational document', () => {
    expect(parseVnDateToIso('19/07/26')).toBe(null);
  });
});

describe('isoToVnDate', () => {
  it('renders the wire value back as a Vietnamese date', () => {
    expect(isoToVnDate('2026-07-19')).toBe('19/07/2026');
  });

  it('renders an empty string for an empty wire value, so an empty field stays empty', () => {
    expect(isoToVnDate('')).toBe('');
  });

  it('renders an empty string for a malformed wire value rather than guessing', () => {
    expect(isoToVnDate('19/07/2026')).toBe('');
    expect(isoToVnDate('2026-13-01')).toBe('');
  });

  it('round-trips every value the parser accepts', () => {
    const typed = '05/03/2026';
    const iso = parseVnDateToIso(typed);
    // Narrow with a guard rather than a cast or a non-null assertion: the
    // cast would silence a null instead of reporting it, and this repo treats
    // non-null assertions as banned. A thrown guard also makes the failure
    // name the actual problem if the parser ever regresses.
    if (iso === null) throw new Error('expected the parser to accept ' + typed);
    expect(isoToVnDate(iso)).toBe(typed);
  });
});
