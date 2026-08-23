// scripts/turbo-release-age.guard.test.ts
// THE ASSERTION THAT WAS MISSING: the turbo PIN and the release-age EXCLUDE
// list must name the same version.
//
// WHAT SHIPPED WITHOUT IT. PR #602 bumped the turbo devDependency to ^2.10.10
// and raised the floor in turbo-version-floor.guard.test.ts, in one commit,
// exactly as that guard's header requires. It left minimumReleaseAgeExclude in
// pnpm-workspace.yaml at 2.10.9 for all seven turbo packages. Every gate passed,
// because the only guard over this pin reads package.json and nothing read the
// workspace file. PR #606 added those seven lines by hand a day later.
//
// minimumReleaseAgeExclude is pnpm's quarantine escape hatch: a package younger
// than the configured minimum age is REFUSED at install unless listed. So the
// gap is not cosmetic -- on a host whose policy cache is cold while the version
// is still inside the age window, the install pnpm-lock.yaml demands is the one
// pnpm-workspace.yaml forbids. It survived CI because the failure is per-HOST:
// pnpm resolves the optional platform binary for the machine it runs on, so a
// missing @turbo/darwin-arm64 entry is invisible on a Linux runner.
//
// A COMPANION, NOT A REPLACEMENT. turbo-version-floor.guard.test.ts asserts the
// pin never drifts BELOW a floor; this asserts the exclude list AGREES with
// whatever the pin currently is. Two different questions over two different
// files, which is why one guard could pass while the other fact was wrong.
//
// It reads the file as TEXT rather than parsing the YAML: the entries are
// human-edited, carry comments and hand-chosen quoting, and a parser would make
// this guard fail on formatting the file legitimately allows. The reader in
// turbo-release-age.ts is exhaustively unit-tested against those shapes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TURBO_PLATFORM_PACKAGES, missingTurboExcludes } from './turbo-release-age.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface RootManifest {
  readonly devDependencies?: { readonly turbo?: string };
}

/** The pinned version, range operator stripped -- the same read
 *  turbo-version-floor.guard.test.ts and bump-turbo.ts both perform. */
function pinnedTurboVersion(): string {
  const raw = readFileSync(resolve(repoRoot, 'package.json'), 'utf8');
  const spec = (JSON.parse(raw) as RootManifest).devDependencies?.turbo ?? 'MISSING';
  return spec.replace(/^[\^~]/, '');
}

/** The minimumReleaseAgeExclude block, as raw lines. Sliced from the key to the
 *  end of file rather than YAML-parsed, so hand-written quoting and comments
 *  cannot break the guard. */
function excludeLines(): readonly string[] {
  const raw = readFileSync(resolve(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  const at = raw.indexOf('minimumReleaseAgeExclude:');
  if (at < 0) return [];
  return raw.slice(at).split('\n').slice(1);
}

describe('turbo release-age exclude agrees with the pin', () => {
  // Vacuity: if either read is broken, every later assertion is meaningless.
  it('finds a pinned turbo version', () => {
    expect(pinnedTurboVersion()).toMatch(/^[0-9]+[.][0-9]+[.][0-9]+$/);
  });

  it('finds a minimumReleaseAgeExclude block', () => {
    expect(excludeLines().length).toBeGreaterThan(0);
  });

  // THE ASSERTION. Failure names the exact packages, so the fix is mechanical
  // rather than a hunt through 25 exclude lines.
  it('exempts EVERY turbo package at the pinned version', () => {
    const version = pinnedTurboVersion();
    expect({ version, missing: missingTurboExcludes(excludeLines(), version) }).toEqual({
      version,
      missing: [],
    });
  });

  // Guards the guard: if a rename ever emptied the package list, the assertion
  // above would pass vacuously against nothing.
  it('checks all seven packages, so the check cannot pass vacuously', () => {
    expect(TURBO_PLATFORM_PACKAGES.length).toBe(7);
  });
});
