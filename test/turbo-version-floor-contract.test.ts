// test/turbo-version-floor-contract.test.ts
// Contract: the repo-wide turbo devDependency must not drift BELOW a known
// floor, and the pin must stay a parseable semver spec with a preserved range
// operator.
//
// Why this exists: //#bump:turbo (scripts/bump-turbo.ts) captures the ACT of
// bumping, but nothing asserted the RESULT. A hand-edit, a bad merge
// resolution, or a revert could silently move the pin backwards and no gate
// would notice -- precisely the drift class the bump task was created to end.
// planTurboBump is already unit-tested for its pure logic; this is the
// complementary state contract on package.json itself.
//
// Raising the floor is deliberate: bump the constant in the SAME commit as the
// pin, so the test and the manifest move together and a downgrade fails CI.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Minimum acceptable turbo version. 2.10.8 fixes pnpm prune dropping root and
// aliased dependencies, which the api Docker image build depends on.
const FLOOR = [2, 10, 8] as const;
const FLOOR_TEXT = FLOOR.join('.');

interface RootManifest {
  readonly devDependencies?: Record<string, string>;
}

const manifestPath = resolve(__dirname, '..', 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RootManifest;
const spec = manifest.devDependencies?.turbo;

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

describe('turbo version floor contract', () => {
  it('declares a turbo devDependency at the repo root', () => {
    expect(spec, 'root package.json must pin turbo').toBeDefined();
  });

  it('pins turbo with a parseable semver version', () => {
    expect(versionOf(spec ?? '')).toMatch(/^[0-9]+[.][0-9]+[.][0-9]+$/);
  });

  it('never drifts below the floor ' + FLOOR_TEXT, () => {
    const actual = versionOf(spec ?? '0.0.0');
    expect(
      compare(actual, FLOOR),
      'turbo pinned at ' + actual + ', below the floor ' + FLOOR_TEXT,
    ).toBeGreaterThanOrEqual(0);
  });

  it('preserves a range operator so patch updates stay available', () => {
    expect(spec ?? '').toMatch(/^[\^~]/);
  });
});
