// packages/design-tokens/test/literal-guard.test.ts
// RED-first: drives src/literal-guard.ts, the raw-color-literal RATCHET core.
//
// WHY A RATCHET AND NOT A BOOLEAN GATE. tokens:check guards SSOT-to-globals.css
// drift, but nothing guards JSX. Proven consequence: commit 16b0511 added a
// text-slate-900 literal to a page that 5ae52ec had migrated two days earlier.
// With 50+ concurrent worktrees literals reappear faster than a manual sweep
// removes them, so the restyle is a treadmill without enforcement.
//
// A boolean gate is not an option: origin/develop carries 274 occurrences across
// 17 files. A permanently-red gate gets disabled within a day. So this is a
// per-file BUDGET that may only decrease -- existing debt is tolerated, new debt
// is rejected, and every migration lowers a ceiling it can never re-raise.
//
// The baseline is TSV, not JSON, and that is load-bearing rather than cosmetic:
// a JSON baseline conflicts on braces and commas whenever two worktrees migrate
// different files in parallel, which in this repo is the normal case. One atomic
// line per file means parallel migrations touch disjoint lines and never conflict.
//
// The pure core lives HERE, not in apps/ops-web/scripts, because that directory
// is outside vitest include (test/**) and outside coverage include (src/**) --
// the same structural blind spot that left decodeUsername untested for weeks.
// Fails at import until src/literal-guard.ts exists.
import { describe, it, expect } from 'vitest';
import {
  countRawColorLiterals,
  parseRatchetTsv,
  formatRatchetTsv,
  compareRatchet,
} from '../src/literal-guard.js';

const SQ = String.fromCharCode(39);
const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);
const HASH = String.fromCharCode(35);

const cn = (value: string): string => 'className=' + SQ + value + SQ;

const mk = (...flat: readonly (string | number)[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (let i = 0; i < flat.length; i += 2) {
    m.set(String(flat.at(i)), Number(flat.at(i + 1)));
  }
  return m;
};

// Positive predicate on purpose: a startsWith-plus-negation form needs either
// the negation operator (avoided in files written via the heredoc transport) or
// a === false comparison (rejected by the house lint config). A regex that
// matches any line NOT opening with the comment marker needs neither.
const isEntry = (line: string): boolean => /^[^#]/.test(line);

describe('countRawColorLiterals', () => {
  it('counts a single raw ramp literal', () => {
    expect(countRawColorLiterals(cn('text-slate-900'))).toBe(1);
  });

  it('counts every literal in one className', () => {
    expect(countRawColorLiterals(cn('bg-white text-slate-900 ring-indigo-300'))).toBe(2);
  });

  it('counts across all utility prefixes', () => {
    const src = cn('bg-red-500 text-gray-100 border-zinc-200 ring-sky-400 divide-teal-300 shadow-amber-500');
    expect(countRawColorLiterals(src)).toBe(6);
  });

  it('counts gradient stops', () => {
    expect(countRawColorLiterals(cn('from-indigo-950 via-slate-900 to-violet-950'))).toBe(3);
  });

  it('ignores semantic token roles', () => {
    const src = cn('text-text-on-dark bg-surface-root ring-border-subtle text-primary-on-dark');
    expect(countRawColorLiterals(src)).toBe(0);
  });

  it('ignores non-numeric colour words', () => {
    expect(countRawColorLiterals(cn('bg-white text-black border-transparent'))).toBe(0);
  });

  it('ignores literals outside a className attribute', () => {
    const src = '// never a raw slate-900 literal' + NL + 'const doc = ' + SQ + 'use bg-slate-950' + SQ + ';';
    expect(countRawColorLiterals(src)).toBe(0);
  });

  it('counts an opacity-suffixed literal once', () => {
    expect(countRawColorLiterals(cn('bg-slate-950/60 border-white/10'))).toBe(1);
  });

  it('returns zero for source with no className', () => {
    expect(countRawColorLiterals('export const x = 1;')).toBe(0);
  });
});

describe('parseRatchetTsv and formatRatchetTsv', () => {
  it('round-trips a baseline', () => {
    const m = mk('src/features/dispatch/OrderReview.tsx', 22, 'src/features/shell/AppShell.tsx', 9);
    expect(parseRatchetTsv(formatRatchetTsv(m))).toEqual(m);
  });

  it('emits one atomic sorted line per file for conflict-free parallel edits', () => {
    const tsv = formatRatchetTsv(mk('b.tsx', 2, 'a.tsx', 1));
    const body = tsv.trimEnd().split(NL).filter(isEntry);
    expect(body.length).toBe(2);
    expect(body.at(0)).toBe('a.tsx' + TAB + '1');
    expect(body.at(1)).toBe('b.tsx' + TAB + '2');
  });

  it('skips comment and blank lines', () => {
    const tsv = HASH + ' header' + NL + NL + 'a.tsx' + TAB + '3';
    expect(parseRatchetTsv(tsv)).toEqual(mk('a.tsx', 3));
  });

  it('omits files whose count reached zero', () => {
    const tsv = formatRatchetTsv(mk('a.tsx', 0, 'b.tsx', 1));
    expect(parseRatchetTsv(tsv)).toEqual(mk('b.tsx', 1));
  });
});

describe('compareRatchet', () => {
  const base = (): Map<string, number> => mk('a.tsx', 5, 'b.tsx', 3);

  it('passes when counts are unchanged', () => {
    const v = compareRatchet(base(), base());
    expect(v.ok).toBe(true);
    expect(v.regressions.length).toBe(0);
  });

  it('passes and reports the improvement when a count decreases', () => {
    const v = compareRatchet(base(), mk('a.tsx', 2, 'b.tsx', 3));
    expect(v.ok).toBe(true);
    expect(v.improvements.length).toBe(1);
    expect(v.improvements.at(0)).toEqual({ file: 'a.tsx', baseline: 5, current: 2 });
  });

  it('FAILS when a count increases', () => {
    const v = compareRatchet(base(), mk('a.tsx', 6, 'b.tsx', 3));
    expect(v.ok).toBe(false);
    expect(v.regressions.at(0)).toEqual({ file: 'a.tsx', baseline: 5, current: 6 });
  });

  it('FAILS when an unlisted file introduces literals', () => {
    const v = compareRatchet(base(), mk('a.tsx', 5, 'b.tsx', 3, 'new.tsx', 1));
    expect(v.ok).toBe(false);
    expect(v.regressions.at(0)).toEqual({ file: 'new.tsx', baseline: 0, current: 1 });
  });

  it('passes when a baselined file disappears entirely', () => {
    const v = compareRatchet(base(), mk('b.tsx', 3));
    expect(v.ok).toBe(true);
    expect(v.improvements.at(0)).toEqual({ file: 'a.tsx', baseline: 5, current: 0 });
  });

  it('reports totals so the debt is measurable', () => {
    const v = compareRatchet(base(), mk('a.tsx', 4, 'b.tsx', 3));
    expect(v.baselineTotal).toBe(8);
    expect(v.currentTotal).toBe(7);
  });

  it('is empty-safe in both directions', () => {
    expect(compareRatchet(mk(), mk()).ok).toBe(true);
    expect(compareRatchet(mk(), mk('x.tsx', 1)).ok).toBe(false);
  });
});
