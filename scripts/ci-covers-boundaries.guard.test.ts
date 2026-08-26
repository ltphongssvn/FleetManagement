// scripts/ci-covers-boundaries.guard.test.ts
// Guard: the CI setup job must keep running turbo boundaries, and every package
// that imports vitest or typescript must keep DECLARING it.
//
// WHY A CI STEP AND NOT A TURBO TASK. The obvious wiring was a //#boundaries
// root task in __ci_fast__, and it was written, tried and reverted: `turbo
// boundaries` IS a turbo operation, so the root script would have to invoke
// turbo, and turbo refuses with recursive_turbo_invocations. This repo already
// recorded the identical finding for //#graph -- "unimplementable by
// construction, so it is removed rather than fed" -- and this is that shape a
// second time. The gate therefore lives in ci.yml, exactly like the E2E Lint
// step whose own comment explains the same placement.
//
// WHY IT EXISTS. turbo boundaries answers a question no other gate here asks:
// does each package declare what it imports, and does it import only from its
// own directory. Its first run reported 716 issues. Four came from a stale
// apps/api/dist and vanished on a clean tree -- boundaries reads BUILD OUTPUT
// as well as source, which is itself worth pinning. The other 712 were vitest
// and typescript imported by workspace packages while declared only at the
// ROOT, and the Turborepo Boundaries RFC names that an anti-pattern rather than
// a false positive: root dependencies are globals affecting every package, they
// make extracting a package impossible, and node resolution is not built for
// it.
//
// The fix was to declare them where they are used, so the gate could be wired
// with ZERO ignore-rules. That is precisely what this guard protects: a future
// package.json edit dropping the declaration would restore the anti-pattern,
// and without an assertion the only signal would be a boundaries failure whose
// cause is three files away.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const CI = resolve(ROOT, '.github', 'workflows', 'ci.yml');

/** Packages that import vitest and must therefore declare it themselves. */
const VITEST_PACKAGES: readonly string[] = [
  'apps/api',
  'apps/driver-app',
  'apps/owner-app',
  'apps/ops-web',
  'packages/domain',
  'packages/sync-protocol',
  'packages/test-fixtures',
  'packages/design-tokens',
  'packages/observability',
  'packages/codemods',
  'workers/main-worker',
];

interface Manifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

function declares(pkgDir: string, dep: string): boolean {
  const raw = readFileSync(resolve(ROOT, pkgDir, 'package.json'), 'utf8');
  const m = JSON.parse(raw) as Manifest;
  return (m.devDependencies?.[dep] ?? m.dependencies?.[dep]) !== undefined;
}

describe('CI runs turbo boundaries', () => {
  const ci = (): string => readFileSync(CI, 'utf8');

  // Vacuity guard FIRST: a workflow that failed to read, or one missing the
  // job this step lives in, would make every later assertion meaningless.
  it('ci.yml is readable and defines the setup job (guard is not vacuous)', () => {
    const text = ci();
    expect(text.length).toBeGreaterThan(1000);
    expect(text).toContain('Install / Build / Lint / Typecheck');
  });

  it('a Package boundaries step is present', () => {
    expect(ci()).toContain('name: Package boundaries');
  });

  it('the step invokes turbo boundaries', () => {
    expect(ci()).toContain('pnpm exec turbo boundaries');
  });

  // Boundaries reads build OUTPUT as well as source, so a stale dist reports
  // findings that no longer exist in the tree -- observed as 4 phantom hits
  // from a pre-rename apps/api/dist. Running after Build makes the artifacts
  // current instead of leftover.
  it('the step runs AFTER the Build step', () => {
    const text = ci();
    expect(text.indexOf('name: Build')).toBeLessThan(text.indexOf('name: Package boundaries'));
  });

  // The recursion is the whole reason this is a CI step; a future edit that
  // reintroduces the root script would fail turbo at run time with
  // recursive_turbo_invocations.
  it('no root script invokes turbo boundaries', () => {
    const pkg = readFileSync(resolve(ROOT, 'package.json'), 'utf8');
    expect(pkg).not.toContain('turbo boundaries');
  });
});

describe('workspace packages declare what they import', () => {
  it('the package list is non-empty (guard is not vacuous)', () => {
    expect(VITEST_PACKAGES.length).toBeGreaterThan(5);
  });

  it.each(VITEST_PACKAGES)('%s declares vitest itself, not via the root', (pkg) => {
    expect(declares(pkg, 'vitest')).toBe(true);
  });

  // test-fixtures imports typescript as a LIBRARY (ts.parseJsonText in
  // jsonc-fixtures.ts), which is a different claim from using it as the
  // compiler -- every package compiles, only this one imports it.
  it('packages/test-fixtures declares typescript itself', () => {
    expect(declares('packages/test-fixtures', 'typescript')).toBe(true);
  });
});
