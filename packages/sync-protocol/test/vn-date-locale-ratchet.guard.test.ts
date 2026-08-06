// packages/sync-protocol/test/vn-date-locale-ratchet.guard.test.ts
// Repo ratchet (t65 Phase 7), mirroring the existing token-literal-ratchet and
// enum-parity-guard patterns.
//
// WHY A GUARD AND NOT JUST A FIX. The defect this arc removed was not one bad
// string: it was THREE independently constructed date formatters (en-US in the
// dispatch board, en-US in the stop cells, en-GB in the Excel export) that
// drifted apart because nothing forced them to agree. Fixing the three call
// sites without a ratchet leaves the same open door: the next component that
// needs a date writes its own Intl.DateTimeFormat, picks a locale from muscle
// memory, and a Vietnamese-only product quietly ships English again. This test
// is what makes that regression fail in CI instead of in front of a dispatcher.
//
// WHAT IS DELIBERATELY ALLOWED. en-CA in owner-metrics.service.ts and
// trip-history-grouping.ts is CORRECT and stays: those build machine grouping
// keys, and en-CA is the locale that emits ISO yyyy-mm-dd ordering. The guard
// therefore targets human-facing locales only (the FORBIDDEN_UI_DATE_LOCALES
// SSOT), never every locale literal. The date-format module itself is exempt
// because it is the one place allowed to name a locale.
//
// The scan is source-level rather than behavioural on purpose: a behavioural
// test can only cover call sites someone remembered to test, while this fails
// on a formatter that has no test at all -- which is the realistic way the
// regression returns.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN_UI_DATE_LOCALES } from '../src/vn-date-format-contract.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');

// Application source only. Tests legitimately mention English locales while
// asserting that none reach the UI, and generated or vendored trees are not
// ours to police.
const SCAN_DIRS = ['apps', 'packages', 'workers'];
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', 'test', 'e2e', '.expo']);
const CODE_SUFFIXES = ['.ts', '.tsx'];

// The single module permitted to name a locale, plus the machine-key modules
// whose en-CA usage is documented and intentional.
const EXEMPT_FILES = [
  join('packages', 'sync-protocol', 'src', 'vn-date-format-contract.ts'),
  join('packages', 'sync-protocol', 'src', 'vn-date-format.ts'),
];

function listCodeFiles(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry)) continue;
    const full = join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      listCodeFiles(full, out);
      continue;
    }
    if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) continue;
    for (const suffix of CODE_SUFFIXES) {
      if (entry.endsWith(suffix)) {
        out.push(full);
        break;
      }
    }
  }
}

function isExempt(path: string): boolean {
  for (const suffix of EXEMPT_FILES) {
    if (path.endsWith(suffix)) return true;
  }
  return false;
}

// A locale literal only matters when it is being handed to a date formatter.
// Number formatting and grouping keys are out of scope, so the line must
// mention a date formatter as well as the forbidden locale.
function isDateFormatterLine(line: string): boolean {
  if (line.includes('DateTimeFormat')) return true;
  if (line.includes('toLocaleDateString')) return true;
  if (line.includes('toLocaleTimeString')) return true;
  if (line.includes('toLocaleString')) return true;
  return false;
}

function findViolations(files: readonly string[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (isExempt(file)) continue;
    const text = readFileSync(file, 'utf8');
    // Cheap whole-file rejection before the per-line scan: the overwhelming
    // majority of source files mention no date formatter at all.
    if (!isDateFormatterLine(text)) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line === undefined) continue;
      if (!isDateFormatterLine(line)) continue;
      for (const locale of FORBIDDEN_UI_DATE_LOCALES) {
        const quoted = String.fromCharCode(39) + locale + String.fromCharCode(39);
        if (line.includes(quoted)) {
          violations.push(file.split(REPO_ROOT + sep).join('') + ':' + String(i + 1) + ' -> ' + locale);
        }
      }
    }
  }
  return violations;
}

// The traversal is the expensive part, and both tests need the same list, so
// it is computed ONCE at module load. The earlier shape walked the tree twice
// and hit the 5s default budget under parallel-worktree CPU contention. The
// fix is to stop doing the work twice, not to raise the budget -- a raised
// budget would hide the next slowdown instead of preventing it.
const ALL_CODE_FILES: string[] = [];
for (const dir of SCAN_DIRS) listCodeFiles(join(REPO_ROOT, dir), ALL_CODE_FILES);

describe('Vietnamese date locale ratchet', () => {
  it('scans a non-trivial number of source files, so a broken walker cannot pass vacuously', () => {
    expect(ALL_CODE_FILES.length).toBeGreaterThan(100);
  });

  it('no application source builds a human-facing date formatter with an English locale', () => {
    expect(findViolations(ALL_CODE_FILES)).toEqual([]);
  });
});
