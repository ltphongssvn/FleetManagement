// scripts/gh-pr-checks-banned.guard.test.ts
//
// Guard: no repo script may use `gh pr checks` as a MERGE-DECISION input.
//
// WHY
// `gh pr checks --json name,state` returns gh's bucketed rendering, in which a
// CANCELLED check is indistinguishable from a FAILURE (cli/cli#7551; the JSON
// `bucket`/`state` field carries the same collapse as the red-cross icon).
// PR #511 was reported "BLOCKED: required checks failed" while carrying zero
// failures -- two jobs were CANCELLED by correct concurrency configuration and
// four were SKIPPED downstream of them.
//
// The information is destroyed BEFORE any classifier runs, so this cannot be
// fixed downstream. `gh pr view --json statusCheckRollup` carries the true
// per-check `conclusion` and is the only sanctioned source.
//
// This guard exists because the wrong call looks entirely reasonable. Fixing the
// two current call sites does not stop the next one from being written, and with
// ~50 parallel worktrees the next one will be written by someone who never saw
// PR #511. A green suite that silently permits the regression is how this defect
// survived in the first place.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPTS_DIR = join(import.meta.dirname, '.');

// Matches the call however it is spelled: argv-array form used by spawnSync
// (['pr', 'checks', ...]) and any plain-string form.
const BANNED = /(['"]pr['"]\s*,\s*['"]checks['"])|(\bgh\s+pr\s+checks\b)/;

// Prose may name the banned command; only executable lines are policed.
function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function offendingLines(source: string): string[] {
  return source
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !isCommentLine(line) && BANNED.test(line))
    .map(({ line, n }) => String(n) + ': ' + line.trim());
}

function scriptFiles(): string[] {
  return readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => !f.endsWith('.test.ts'));
}

describe('guard: gh pr checks is banned as a merge-decision input', () => {
  it('finds script files to police (a zero-file sweep would pass vacuously)', () => {
    expect(scriptFiles().length).toBeGreaterThan(10);
  });

  for (const file of scriptFiles()) {
    it('does not call gh pr checks: ' + file, () => {
      const offences = offendingLines(readFileSync(join(SCRIPTS_DIR, file), 'utf-8'));
      expect(offences).toEqual([]);
    });
  }
});

describe('guard self-test (the guard must actually detect the pattern)', () => {
  it('flags the argv-array form', () => {
    expect(offendingLines("const r = sh('gh', ['pr', 'checks', String(n)]);")).toHaveLength(1);
  });

  it('flags the plain-string form', () => {
    expect(offendingLines('run("gh pr checks 511");')).toHaveLength(1);
  });

  it('does not flag prose in a comment', () => {
    expect(offendingLines('// never call gh pr checks here')).toEqual([]);
  });

  it('does not flag the sanctioned endpoint', () => {
    expect(offendingLines("sh('gh', ['pr', 'view', String(n), '--json', 'statusCheckRollup']);")).toEqual([]);
  });
});
