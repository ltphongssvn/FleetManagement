// scripts/turbo-version-floor.guard.test.ts
// Guard (root-cause fix): the repo-wide turbo devDependency must never drift
// BELOW a known floor, and the pin must stay a parseable semver spec with its
// range operator intact.
//
// Why this exists: //#bump:turbo (scripts/bump-turbo.ts) captures the ACT of
// bumping and planTurboBump is unit-tested for its pure logic, but nothing
// asserted the RESULT. A hand-edit, a bad merge resolution, or a revert could
// silently move the pin backwards and no gate would notice -- the same class of
// hole that ci-fast-covers-test-scripts.guard.test.ts closed for the scripts
// suite.
//
// This guard lives under scripts/ ON PURPOSE, matching the sibling guard: the
// root test:scripts suite (vitest run scripts) is what //#test:scripts runs, and
// that task is wired into __ci_fast__. A contract test placed in the repo-root
// test/ directory is executed by NO registered task and therefore gates nothing
// -- verified empirically: turbo run test:scripts reports 34 files, all of them
// under scripts/.
//
// Raising the floor is deliberate: bump FLOOR in the SAME commit as the pin, so
// the guard and the manifest move together and a downgrade fails the PR gate.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

// Minimum acceptable turbo version. 2.10.8 fixes pnpm prune dropping root and
// aliased dependencies, which the api Docker image build depends on.
const FLOOR = [2, 10, 8] as const;
const FLOOR_TEXT = FLOOR.join('.');

interface RootManifest {
  readonly devDependencies?: Record<string, string>;
}

function turboSpec(): string | undefined {
  const raw = readFileSync(resolve(repoRoot, 'package.json'), 'utf8');
  return (JSON.parse(raw) as RootManifest).devDependencies?.turbo;
}

// Strip a leading range operator, mirroring scripts/bump-turbo.ts splitSpec.
function versionOf(raw: string): string {
  return raw.startsWith('^') || raw.startsWith('~') ? raw.slice(1) : raw;
}

function compare(actual: string, floor: readonly number[]): number {
  const parts = actual.split('.').map(Number);
  for (let i = 0; i < floor.length; i += 1) {
    const got = parts[i] ?? 0;
    const want = floor[i] ?? 0;
    if (got !== want) return got - want;
  }
  return 0;
}

describe('turbo version floor guard', () => {
  it('declares a turbo devDependency at the repo root (guard is not vacuous)', () => {
    expect(turboSpec(), 'root package.json must pin turbo').toBeDefined();
  });

  it('pins turbo with a parseable semver version', () => {
    expect(versionOf(turboSpec() ?? '')).toMatch(/^[0-9]+[.][0-9]+[.][0-9]+$/);
  });

  it('never drifts below the floor ' + FLOOR_TEXT, () => {
    const actual = versionOf(turboSpec() ?? '0.0.0');
    expect(
      compare(actual, FLOOR),
      'turbo pinned at ' + actual + ', below the floor ' + FLOOR_TEXT,
    ).toBeGreaterThanOrEqual(0);
  });

  it('preserves a range operator so patch updates stay available', () => {
    expect(turboSpec() ?? '').toMatch(/^[\^~]/);
  });
});
