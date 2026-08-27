// apps/api/test/hook-timeout-ssot.guard.test.ts
// Regression guard (root-cause fix 2026-07-16): hookTimeout is configured in
// ONE place per config, and per-hook literals must not override it.
//
// History: 9710dd8 (2026-07-07) fixed the third recurrence of PGlite hook
// timeouts. Its diagnosis stands and is not revisited here: the root cause is
// SCHEDULING (up to 6 parallel worktree terminals starving an 8-core box), not
// budgets. It shipped three layers -- a machine-global flock on the pre-push
// gate, hookTimeout 60s -> 180s, and a sweep of 39 per-file literals -- and
// explicitly locked the anti-patterns: config raise without the sweep (inert,
// because per-hook literals OVERRIDE config), and per-file bumps (treadmill).
//
// It shipped no guard. So it drifted back: 24 per-hook literals have
// reaccumulated, and the config raise never reached vitest.config.ts, which is
// what test:unit reads. A fourth recurrence duly arrived --
// passkey-credential.repository.test.ts dying at exactly 60000ms under
// __ci_fast__ while passing in isolation, the same CPU-thrash signature.
//
// The sweep was manual, so it could not hold. This guard is what makes it
// stick: the durable fix is not another sweep, it is the thing that prevents
// the next one from being needed.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, '..');
const NL = String.fromCharCode(10);
const SLASH = String.fromCharCode(47);
const LINE_COMMENT = SLASH + SLASH;
// Code-only view (pg-global-setup-no-reuse-orphan-guard.test.ts precedent):
// drop line-comment lines so an assertion about CODE is never tripped by prose
// that merely mentions the pattern -- including this file's own header.
const isCommentLine = (line: string): boolean => line.trimStart().startsWith(LINE_COMMENT);
const codeOnly = (src: string): string =>
  src
    .split(NL)
    .filter((line) => !isCommentLine(line))
    .join(NL);
const CONFIGS = [
  'vitest.config.ts',
  'vitest.coverage.config.ts',
  'vitest.integration.config.ts',
] as const;
// PGlite WASM cold-start headroom under parallel-worktree load. Single value,
// all configs: test:unit reads vitest.config.ts, and it flaked precisely
// because 9710dd8 raised only the other two.
const HOOK_TIMEOUT_SSOT = 180_000;
// testTimeout stays independent and tight -- 9710dd8: long test timeouts mask
// real defects. Only hook budgets absorb cold-start.
const TEST_TIMEOUT_SSOT = 60_000;
function readConfig(name: string): string {
  return codeOnly(readFileSync(resolve(apiRoot, name), 'utf8'));
}
describe('hookTimeout SSOT guard', () => {
  it.each(CONFIGS)('%s sets the shared hookTimeout headroom', (name) => {
    expect(readConfig(name)).toContain('hookTimeout: 180_000');
  });
  it.each(CONFIGS)('%s keeps testTimeout tight and independent', (name) => {
    expect(readConfig(name)).toContain('testTimeout: 60_000');
  });
  it('every config agrees -- no config is left behind on a raise', () => {
    const values = CONFIGS.map((name) => {
      const m = /hookTimeout:\s*([0-9_]+)/.exec(readConfig(name));
      const captured = m?.[1];
      return captured === undefined ? null : Number(captured.replace(/_/g, ''));
    });
    expect(values).toEqual([HOOK_TIMEOUT_SSOT, HOOK_TIMEOUT_SSOT, HOOK_TIMEOUT_SSOT]);
  });
  it('testTimeout stays below hookTimeout in every config', () => {
    expect(TEST_TIMEOUT_SSOT).toBeLessThan(HOOK_TIMEOUT_SSOT);
  });
});
describe('no per-hook timeout literal overrides the config', () => {
  // The trailing-argument form beforeAll(fn, 90_000) OVERRIDES the config
  // value. That is what made 9710dd8's raise provably inert for exactly the
  // files that flaked: the third failure died at 60s carrying its own 60s
  // literal.
  //
  // Scope is HOOKS ONLY. it(fn, 60_000) is a testTimeout override and remains
  // legitimate -- 9710dd8 swept hooks and kept the test budget independent and
  // tight, because long test timeouts mask real defects.
  //
  // Deliberately NOT a regex. Two regex attempts were wrong in opposite
  // directions: a body-spanning [\s\S]*? walked out of the hook and
  // terminated on the next it(...) literal, reporting 14 phantom offenders;
  // tightening it then matched nothing at all -- a vacuous green, which is
  // worse. Instead: find the hook keyword, walk brackets to its true closing
  // paren, and inspect only what follows the final brace. Nested braces in the
  // body cannot confuse it, and the it(...) form is structurally excluded.
  const HOOKS = ['beforeAll(', 'beforeEach('] as const;
  const TRAILING_LITERAL = /^\s*,\s*[0-9]+(_[0-9]+)?\s*$/;
  const OPENERS = '([{';
  const CLOSERS = ')]}';
  function hookLiteralsIn(src: string): string[] {
    const found: string[] = [];
    for (const kw of HOOKS) {
      let i = src.indexOf(kw);
      while (i >= 0) {
        let j = i + kw.length;
        let depth = 0;
        while (j < src.length) {
          const c = src.charAt(j);
          if (OPENERS.includes(c)) depth += 1;
          else if (CLOSERS.includes(c)) {
            if (depth === 0 && c === ')') break;
            depth -= 1;
          }
          j += 1;
        }
        const call = src.slice(i, j);
        const lastBrace = call.lastIndexOf('}');
        const tail = lastBrace >= 0 ? call.slice(lastBrace + 1) : '';
        if (TRAILING_LITERAL.test(tail)) found.push(call.slice(0, 40));
        i = src.indexOf(kw, j);
      }
    }
    return found;
  }
  // Exclude this file. Its self-test fixtures are string literals containing
  // the exact pattern being scanned for, so it necessarily flags itself -- a
  // scanner cannot meaningfully scan its own fixtures. codeOnly() strips
  // comments, not strings. The 'guard actually works' case above is what keeps
  // this exclusion honest.
  const SELF = 'hook-timeout-ssot.guard.test.ts';
  const testFiles = readdirSync(apiRoot + SLASH + 'test')
    .filter((f) => f.endsWith('.test.ts'))
    .filter((f) => f !== SELF);
  it('finds test files to scan (guard is not vacuously green)', () => {
    expect(testFiles.length).toBeGreaterThan(50);
  });
  it('detects a hook literal when one exists (guard actually works)', () => {
    expect(hookLiteralsIn('beforeAll(async () => { await x(); }, 90_000);')).toHaveLength(1);
    const multiline = 'beforeAll(async () => {' + NL + '  const a = { b: 1 };' + NL + '}, 90_000);';
    expect(hookLiteralsIn(multiline)).toHaveLength(1);
  });
  it('does not flag an it() test-level timeout or a clean hook', () => {
    expect(hookLiteralsIn('it(name, async () => { await x(); }, 60_000);')).toEqual([]);
    expect(hookLiteralsIn('beforeAll(async () => { await x(); });')).toEqual([]);
  });
  it('no test file carries a per-hook timeout literal', () => {
    const offenders = testFiles.filter(
      (f) =>
        hookLiteralsIn(codeOnly(readFileSync(apiRoot + SLASH + 'test' + SLASH + f, 'utf8')))
          .length > 0,
    );
    expect(offenders).toEqual([]);
  });
});
