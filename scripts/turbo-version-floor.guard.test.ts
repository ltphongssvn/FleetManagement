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
// -- verified empirically: turbo run test:scripts reports only scripts/ files.
//
// Assertion style: diagnostics travel INSIDE the asserted value as a labelled
// object, so a failure diff names the pinned version and the floor it violated
// instead of printing a bare boolean. NOTE (2026-08-08): this was originally a
// WORKAROUND -- the repo's eslint config rejected the 2-arg
// expect(value, message) form via vitest/valid-expect. That was a false
// positive (Vitest, unlike Jest, supports a message argument; the rule defaults
// minArgs/maxArgs to 1) and it was fixed at the config with maxArgs: 2. The
// labelled-object style is kept here because it reads well and the assertions
// pass; new specs may use either form.
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

// `turbo` is a NAMED optional property, not Record<string, string>.
//
// WHY NOT Record (2026-08-08). The previous shape read
// `.devDependencies?.turbo` off a Record<string, string>, which is TS4111 under
// noPropertyAccessFromIndexSignature -- Record<string, string> is the
// dynamic-key form and dot access on an index signature is what the flag
// rejects. Bracket access would have compiled while leaving the real weakness:
// nothing constrains the key, so a typo would read undefined and this guard
// would report MISSING, i.e. fail claiming the repo has no turbo pin when the
// mistake is in the guard. Naming the key makes a misspelling a compile error
// and removes the index signature the flag was objecting to. Mirrors the same
// change in scripts/bump-turbo.ts, which reads the identical field.
interface RootManifest {
  readonly devDependencies?: { readonly turbo?: string };
}

function turboSpec(): string {
  const raw = readFileSync(resolve(repoRoot, 'package.json'), 'utf8');
  return (JSON.parse(raw) as RootManifest).devDependencies?.turbo ?? 'MISSING';
}

// Strip a leading range operator, mirroring scripts/bump-turbo.ts splitSpec.
function versionOf(raw: string): string {
  return raw.startsWith('^') || raw.startsWith('~') ? raw.slice(1) : raw;
}

function isBelow(actual: string, floor: readonly number[]): boolean {
  const parts = actual.split('.').map(Number);
  for (let i = 0; i < floor.length; i += 1) {
    const got = parts[i] ?? 0;
    const want = floor[i] ?? 0;
    if (got !== want) return got < want;
  }
  return false;
}

describe('turbo version floor guard', () => {
  // Vacuity check: a missing pin would make every later assertion meaningless.
  it('declares a turbo devDependency at the repo root', () => {
    expect(turboSpec()).not.toBe('MISSING');
  });

  it('pins turbo with a parseable semver version', () => {
    expect(versionOf(turboSpec())).toMatch(/^[0-9]+[.][0-9]+[.][0-9]+$/);
  });

  it('never drifts below the floor ' + FLOOR_TEXT, () => {
    const pinned = versionOf(turboSpec());
    expect({ pinned, floor: FLOOR_TEXT, belowFloor: isBelow(pinned, FLOOR) })
      .toEqual({ pinned, floor: FLOOR_TEXT, belowFloor: false });
  });

  it('preserves a range operator so patch updates stay available', () => {
    expect(turboSpec()).toMatch(/^[\^~]/);
  });
});
