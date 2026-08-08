// scripts/eas-prebuild-hook-topological.guard.test.ts
// GUARD: the eas-build-pre-install hook must derive the packages it builds from
// the dependency GRAPH, never from a hand-written list.
//
// ROOT CAUSE THIS FIXES. EAS runs pnpm install on its own machine but nothing
// pulls turbo's ^build, because apps/driver-app and apps/owner-app have no
// build task -- their build IS the EAS bundle. The hook was the hand-rolled
// stand-in, enumerating three packages by name. Lists drift, and this one
// drifted BOTH ways:
//   - @fleet/design-tokens was added to both RN apps during the t8 restyle arc
//     and never added to the hook, so dist was never built on the EAS machine
//     and Metro could not resolve @fleet/design-tokens/react-native. iOS was
//     broken for ~2 months across 15 consecutive ERRORED builds.
//   - @fleet/domain is enumerated but is NOT a dependency of either RN app.
//     Every EAS build has been compiling it for nothing.
//
// THE FIX. turbo's ^... selector walks the same graph turbo builds from each
// package.json's dependencies/devDependencies, in topological order:
//   pnpm exec turbo run build --filter=@fleet/driver-app^...
// A new workspace dependency creates a graph edge automatically, so there is
// no list left to go stale. turbo.jsonc already declares build.dependsOn
// ["^build"], so the topology was always modelled correctly -- only the RN
// apps' lack of a build task kept it from being used. Verified against the
// real graph: ^... for driver-app resolves to exactly design-tokens,
// observability, sync-protocol -- and notably not domain.
//
// WHY NOT GIVE THE RN APPS A build TASK. That is the more idiomatic shape, but
// turbo's build task owns outputs dist/**, .next/**, build/** -- pointing it at
// Expo prebuild output would entangle EAS artifacts with the turbo cache for no
// added safety. The filter expresses the same topology without that surface.
//
// WHY NOT SOURCE EXPORTS FOR THESE THREE. Unlike @fleet/design-tokens (whose
// ./react-native subpath has no Node consumer and points at .ts source),
// observability/sync-protocol/domain are imported by @fleet/api,
// @fleet/main-worker and @fleet/ops-web under Node. Node refuses type stripping
// for files under node_modules, and pnpm resolves workspace packages through
// node_modules/.pnpm -- so these MUST keep emitting dist. The hook is
// load-bearing for them, not vestigial.
//
// ON THE EXCLUSION TEST. An earlier draft matched enumerated packages with
// /--filter[= ]@fleet\/[a-z-]+(?![.^])/ and flagged the CORRECT topological
// selector: the greedy class consumed up to the caret, the lookahead forced a
// one-character backtrack, and '--filter=@fleet/driver-ap' matched. The
// distinction is not lexical trailing punctuation -- it is whether a named
// package is followed by the ^... selector. Matched to a word boundary, then
// inspected, rather than encoded in a lookahead.

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Apps whose native build runs on EAS rather than through a turbo build task. */
const EAS_APPS = ['apps/driver-app', 'apps/owner-app'] as const;

interface PkgJson {
  scripts?: Record<string, string>;
}

function readPkg(relDir: string): PkgJson | null {
  const p = join(repoRoot, relDir, 'package.json');
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as PkgJson) : null;
}

/**
 * Package name for an app directory. The segment is bound and guarded rather
 * than indexed inline: noUncheckedIndexedAccess types split()[1] as
 * string | undefined, and the house pattern for that is a guarded bind, not a
 * ?? fallback that adds a branch no input can reach.
 */
function packageNameFor(appDir: string): string {
  const leaf = appDir.split('/')[1];
  return leaf === undefined ? appDir : '@fleet/' + leaf;
}

const APPS = EAS_APPS.filter((a) => readPkg(a) !== null).map((app) => ({
  app,
  pkg: packageNameFor(app),
  hook: readPkg(app)?.scripts?.['eas-build-pre-install'] ?? '',
}));

interface FilterTarget {
  pkg: string;
  topological: boolean;
}

/**
 * Every --filter target in a hook, paired with whether it carries the ^...
 * topological selector. A target WITHOUT the selector is an enumeration.
 */
function filterTargets(hook: string): FilterTarget[] {
  const out: FilterTarget[] = [];
  const re = /--filter[= ](@fleet\/[a-z0-9-]+)(\^?\.\.\.)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(hook)) !== null) {
    const pkg = m[1];
    if (pkg === undefined) continue;
    out.push({ pkg, topological: m[2] === '^...' });
  }
  return out;
}

describe('EAS pre-install hook is graph-derived', () => {
  it('finds EAS apps to guard', () => {
    expect(APPS.length).toBeGreaterThan(0);
  });

  it.each(APPS)('$app declares an eas-build-pre-install hook', ({ app, hook }) => {
    expect(hook, app + ' has no eas-build-pre-install hook').not.toBe('');
  });

  it.each(APPS)('$app hook enumerates no workspace package', ({ app, hook }) => {
    const enumerated = filterTargets(hook)
      .filter((t) => !t.topological)
      .map((t) => t.pkg);
    expect(
      enumerated,
      app + ' hook names workspace packages without the ^... selector: ' +
        enumerated.join(' ') + '. A hand-written list drifts -- @fleet/design-tokens ' +
        'was missed for ~2 months and @fleet/domain was built for nothing.',
    ).toEqual([]);
  });

  it.each(APPS)('$app hook uses its own topological selector', ({ app, pkg, hook }) => {
    expect(
      filterTargets(hook).some((t) => t.pkg === pkg && t.topological),
      app + ' hook must build its graph dependencies via: ' +
        'pnpm exec turbo run build --filter=' + pkg + '^...',
    ).toBe(true);
  });

  it.each(APPS)('$app hook builds through turbo, not pnpm recursion', ({ app, hook }) => {
    expect(hook, app + ' hook must invoke turbo').toContain('turbo run build');
  });

  it.each(APPS)('$app hook runs from the repo root with a frozen lockfile', ({ app, hook }) => {
    expect(hook, app + ' hook must cd to the repo root before invoking turbo').toContain('cd ../..');
    expect(hook, app + ' hook must install with a frozen lockfile').toContain('--frozen-lockfile');
  });
});
