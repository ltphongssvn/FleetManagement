// apps/ops-web/scripts/token-literal-ratchet.mts
// ops-web driver for the raw-color-literal ratchet. Imports the PURE core from
// @fleet/design-tokens by package name (ops-web declares it as a workspace
// dependency) and owns apps/ops-web/design-token-ratchet.tsv -- no cross-package
// filesystem reach, matching build-tokens.mts and the 2026 Turborepo boundary
// rule. Runs on plain Node via .mts (always ESM; Node strips types) so there is
// no tsx phantom dependency.
//
// Two modes, driven by the ops-web Turbo task:
//   tokens:lint              -> check: exit 1 if any file EXCEEDS its budget
//   tokens:lint -- --tighten -> rewrite the baseline to current counts
//
// Only --tighten writes, and by construction it can only lower budgets: the
// numbers it writes are the counts actually measured. There is no path that
// raises a budget except editing the TSV by hand, which shows up in review as
// exactly what it is.
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, sep } from 'node:path';
import {
  countRawColorLiterals,
  parseRatchetTsv,
  formatRatchetTsv,
  compareRatchet,
} from '@fleet/design-tokens/literal-guard';

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, '..');
const SRC_ROOT = resolve(APP_ROOT, 'src');
const BASELINE = resolve(APP_ROOT, 'design-token-ratchet.tsv');

// Posix-normalised so a baseline written on one platform matches on another.
const toPosix = (p: string): string => p.split(sep).join('/');

// Positive-named wrappers so no call site needs a negation operator (avoided in
// files written via the heredoc transport) or a === false comparison (rejected
// by the house lint config).
const missing = (path: string): boolean => existsSync(path) ? false : true;
const failed = (ok: boolean): boolean => ok ? false : true;

function collectTsxFiles(dir: string, acc: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      collectTsxFiles(full, acc);
      continue;
    }
    if (entry.endsWith('.tsx')) acc.push(full);
  }
  return acc;
}

function scan(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of collectTsxFiles(SRC_ROOT, [])) {
    const n = countRawColorLiterals(readFileSync(file, 'utf8'));
    if (n > 0) counts.set(toPosix(relative(APP_ROOT, file)), n);
  }
  return counts;
}

const tighten = process.argv.includes('--tighten');
const current = scan();

if (tighten) {
  const previous = existsSync(BASELINE)
    ? parseRatchetTsv(readFileSync(BASELINE, 'utf8'))
    : new Map<string, number>();
  const verdict = compareRatchet(previous, current);
  // Refuse to tighten while a regression is outstanding. Otherwise --tighten
  // becomes the escape hatch that launders new debt into the baseline, which is
  // the one failure mode that would make the whole ratchet decorative.
  if (failed(verdict.ok) && existsSync(BASELINE)) {
    console.error('[tokens:lint] REFUSED to tighten: ' + String(verdict.regressions.length) +
      ' file(s) exceed the current baseline. Migrate or revert them first.');
    for (const r of verdict.regressions) {
      console.error('  ' + r.file + ': allowed ' + String(r.baseline) + ', found ' + String(r.current));
    }
    process.exit(1);
  }
  writeFileSync(BASELINE, formatRatchetTsv(current));
  console.error('[tokens:lint] baseline written: ' + String(current.size) +
    ' file(s), ' + String(verdict.currentTotal) + ' literal(s).');
  if (verdict.improvements.length > 0) {
    console.error('[tokens:lint] tightened ' + String(verdict.improvements.length) +
      ' file(s); total ' + String(verdict.baselineTotal) + ' -> ' + String(verdict.currentTotal) + '.');
  }
  process.exit(0);
}

if (missing(BASELINE)) {
  console.error('[tokens:lint] no baseline at design-token-ratchet.tsv.');
  console.error('[tokens:lint] Create it: turbo run tokens:lint --filter=@fleet/ops-web -- --tighten');
  process.exit(2);
}

const verdict = compareRatchet(parseRatchetTsv(readFileSync(BASELINE, 'utf8')), current);

if (failed(verdict.ok)) {
  console.error('[tokens:lint] RAW COLOR LITERALS INCREASED in ' +
    String(verdict.regressions.length) + ' file(s).');
  for (const r of verdict.regressions) {
    const how = r.baseline === 0 ? 'not baselined' : 'allowed ' + String(r.baseline);
    console.error('  ' + r.file + ': ' + how + ', found ' + String(r.current));
  }
  console.error('[tokens:lint] Use a semantic role from @fleet/design-tokens instead of a raw');
  console.error('[tokens:lint] ramp literal. globals.css exposes the roles as @theme variables.');
  console.error('[tokens:lint] Budgets may only DECREASE; --tighten will not absorb new debt.');
  process.exit(1);
}

const pending = verdict.improvements.length;
console.error('[tokens:lint] OK. ' + String(verdict.currentTotal) + ' literal(s) across ' +
  String(current.size) + ' file(s), budget ' + String(verdict.baselineTotal) + '.');
if (pending > 0) {
  console.error('[tokens:lint] ' + String(pending) + ' file(s) now below budget -- run --tighten to lock the gain.');
}
