// scripts/secrets-baseline-age-keys.test.ts
// Contract: age PUBLIC keys are excluded from secret scanning STRUCTURALLY,
// not labelled one at a time in the baseline.
//
// ROOT CAUSE THIS CLOSES, hit 2026-08-10 on the first commit of the SOPS/age
// arc: detect-secrets flagged seven Base64HighEntropyString findings, every one
// of them an age PUBLIC key -- in .sops.yaml and in test fixtures. Publishing
// an age public key grants nothing; that is the entire point of the scheme.
//
// Baselining them would have "worked" and would have been a treadmill. The
// recipient list grows by design: every laptop added to .age-recipients mints
// another high-entropy string, so every future machine would produce a fresh
// finding, another baseline refresh, and another audit round -- forever, for
// values that are published on purpose. Worse, a baseline crowded with benign
// entries is one nobody reads, which is how a REAL finding slips through.
//
// detect-secrets has the right layer for this: filters, added expressly to
// weed out false positives. --exclude-lines is the config-only form, so the
// exclusion is declared once and applies to every file and every future key.
//
// THE PARITY REQUIREMENT is the other half. The hook and this task each carry
// their own flags, and secrets-baseline.ts already documents that its exclude
// list "mirrors the exclude list in .pre-commit-config.yaml". A mirror that
// nothing checks drifts: the task would refresh a baseline the hook then
// rejects, which is precisely the version-drift failure pickDetectSecretsBinary
// exists to prevent. So the two are asserted equal here.
//
// SCOPE, deliberately narrow: only the age PUBLIC key shape is excluded.
// AGE-SECRET-KEY-* is NOT excluded and must never be -- a private identity in
// tracked source is a genuine incident, and the PrivateKeyDetector plugin plus
// detect-private-key hook must keep their shot at it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGE_PUBLIC_KEY_PATTERN,
  EXCLUDE_LINE_PATTERNS,
  EXCLUDE_PATTERNS,
  scanArgs,
} from './secrets-baseline.js';

const ROOT = join(import.meta.dirname, '..');
const hookConfig = readFileSync(join(ROOT, '.pre-commit-config.yaml'), 'utf-8');

const REAL_PUBLIC_KEY = 'age1022fpw0nt5xdw5txz86cl5whgeq2u3cxhtx9anuvz0twawyh84lqwl0etj';
const FIXTURE_PUBLIC_KEY = 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p';

describe('AGE_PUBLIC_KEY_PATTERN', () => {
  it('matches a real age public key', () => {
    expect(new RegExp(AGE_PUBLIC_KEY_PATTERN).test(REAL_PUBLIC_KEY)).toBe(true);
  });

  it('matches a public key embedded in a YAML line', () => {
    const line = '        ' + FIXTURE_PUBLIC_KEY;
    expect(new RegExp(AGE_PUBLIC_KEY_PATTERN).test(line)).toBe(true);
  });

  it('matches a public key embedded in a TypeScript literal', () => {
    const line = "const KEY_A = '" + FIXTURE_PUBLIC_KEY + "';";
    expect(new RegExp(AGE_PUBLIC_KEY_PATTERN).test(line)).toBe(true);
  });

  it('does NOT match an age PRIVATE key -- that stays scannable', () => {
    const line = 'AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ';
    expect(new RegExp(AGE_PUBLIC_KEY_PATTERN).test(line)).toBe(false);
  });

  it('does NOT match an arbitrary high-entropy base64 blob', () => {
    // BUILT AT RUNTIME rather than written as a literal, and the reason is the
    // whole point of this file. The first draft embedded a fake base64 blob
    // inline; detect-secrets flagged it as Base64HighEntropyString and blocked
    // the commit -- correctly, since it is not an age key and nothing should
    // exempt it. Baselining a test fixture teaches the reflex that a blocked
    // commit is fixed by widening the allowlist, which is how a real credential
    // eventually gets waved through. Encoding it here means the SOURCE holds no
    // high-entropy string at all, so there is nothing for any scanner -- this
    // one or a cloud one that ignores our baseline -- to flag.
    const blob = Buffer.from('helloworld1234567890abcdefghijklmnop').toString('base64');
    const line = 'token = ' + JSON.stringify(blob);
    expect(new RegExp(AGE_PUBLIC_KEY_PATTERN).test(line)).toBe(false);
  });

  it('does NOT match a too-short age-prefixed string', () => {
    expect(new RegExp(AGE_PUBLIC_KEY_PATTERN).test('age1short')).toBe(false);
  });
});

describe('scanArgs wires the line exclusion', () => {
  it('passes --exclude-lines', () => {
    expect(scanArgs('.secrets.baseline')).toContain('--exclude-lines');
  });

  it('passes the age pattern as the exclude-lines value', () => {
    const args = scanArgs('.secrets.baseline');
    const idx = args.indexOf('--exclude-lines');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toContain(AGE_PUBLIC_KEY_PATTERN);
  });

  it('still passes --exclude-files -- the two are independent', () => {
    expect(scanArgs('.secrets.baseline')).toContain('--exclude-files');
  });

  it('keeps the baseline in place rather than redirecting output', () => {
    expect(scanArgs('.secrets.baseline')).toContain('--baseline');
  });
});

describe('hook and task agree -- a mirror nothing checks drifts', () => {
  it('the hook config carries the same age pattern', () => {
    expect(hookConfig).toContain(AGE_PUBLIC_KEY_PATTERN);
  });

  it('every file-exclude pattern in the task is also excluded by the hook', () => {
    // Compared on the FILENAME, not the raw pattern. The two express the same
    // exclusion in different dialects -- the hook writes pnpm-lock[\\.]yaml as
    // pnpm-lock\\.yaml -- so asserting string equality would fail on a pair that
    // agrees perfectly. Normalising both to the literal name they match keeps
    // the assertion about MEANING rather than spelling, which is what parity
    // actually requires.
    const normalise = (p: string): string => p.replace(/\[\.\]/g, '.').replace(/\\\./g, '.');
    const hookNormalised = normalise(hookConfig);
    for (const pattern of EXCLUDE_PATTERNS) {
      expect(hookNormalised).toContain(normalise(pattern));
    }
  });

  it('every line-exclude pattern in the task also appears in the hook', () => {
    for (const pattern of EXCLUDE_LINE_PATTERNS) {
      expect(hookConfig).toContain(pattern);
    }
  });

  it('the hook does NOT exclude the private-key shape', () => {
    // Asserted against the ARGS LINE, not the whole file. The first draft
    // scanned the file and failed on the surrounding comment, which explains
    // at length that AGE-SECRET-KEY-* is deliberately NOT excluded -- the test
    // flagged its own documentation. Prose that names a forbidden pattern is
    // not the same as config that applies it, and a guard which cannot tell
    // them apart teaches the next author to delete the explanation rather than
    // fix the check.
    const argsLine = hookConfig
      .split(String.fromCharCode(10))
      .find((l) => l.includes('--exclude-lines'));
    expect(argsLine).toBeDefined();
    expect(String(argsLine)).not.toContain('AGE-SECRET-KEY');
  });
});
