// scripts/rn-workspace-deps-resolve.guard.test.ts
// GUARD: every @fleet/* subpath a React Native app imports must be resolvable
// BY METRO, not merely by Vitest and tsc.
//
// ROOT CAUSE THIS FIXES. @fleet/design-tokens exposed ./react-native as
// { types, import } -> ./dist/react-native.js. Metro's condition set for React
// Native does not include 'import', and no 'default' was offered, so the
// subpath matched nothing and the EAS bundle failed: "Unable to resolve module
// @fleet/design-tokens/react-native". It passed every local gate.
// packages/design-tokens/test/react-native.test.ts imports the TS source
// directly and never consults the exports map, and neither driver-app nor
// owner-app has a turbo build task -- their build IS the EAS bundle. iOS was
// broken for ~2 months across 15 consecutive ERRORED builds before a driver
// registering a phone surfaced it.
//
// WHAT MAKES A SUBPATH RESOLVABLE. Per Metro's documented resolution
// algorithm, condition names are asserted from the union of 'default',
// 'import' OR 'require' according to context.isESMImport,
// unstable_conditionNames and unstable_conditionNamesByPlatform. 'default' is
// ALWAYS in that union, so a subpath offering 'default' resolves without a
// react-native condition -- which is why @fleet/observability and
// @fleet/sync-protocol work today on { types, default }. Requiring
// react-native everywhere would fail packages that are demonstrably fine, so
// this guard requires react-native OR default.
//
// It deliberately does NOT hard-code "the conditions Metro matches": the
// published defaults disagree across sources (Metro docs say
// ['require','react-native']; the RN 0.72 blog says
// ['require','import','react-native']; Expo ships another set). Encoding that
// list would be a fabricated invariant. Only 'default'-always-matches is
// relied on, because it falls out of the algorithm itself.
//
// WHERE 'react-native' IS DECLARED, IT MUST POINT AT SOURCE. Metro transforms
// TypeScript directly, so a source target needs no dist, nothing added to an
// eas-build-pre-install allowlist, and nothing that goes stale when a package
// is added -- the stale-allowlist failure mode disappears. Per 2026 practice,
// internal (never-published) packages should not carry a build step in the
// bundler path.
//
// AND IT MUST NOT SIT BESIDE 'import'. facebook/metro#1278: when a subpath
// offers both 'import' and 'react-native', Metro may select 'import', and
// reordering unstable_conditionNames does NOT fix it -- only removing 'import'
// does. Ordering alone cannot be relied on, so RN-targeted subpaths omit
// 'import' entirely. Node-only subpaths (e.g. ./emit-ops-web) are untouched.
//
// SCOPE IS DERIVED, NOT DECLARED. Cases come from scanning RN app sources for
// real import specifiers. An earlier draft asserted over every subpath in the
// exports map and wrongly failed ./emit-ops-web -- the Node-side Tailwind
// emitter that only apps/ops-web/scripts/build-tokens.mts loads.
//
// FOLLOW-UP: these five assertions share one (app, dep, dir, subpath) case and
// would read better as describe.for, which creates a suite per case. Left as
// it.each here to avoid reworking the parameterisation while the assertions
// were still being corrected.

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Apps whose bundler is Metro. */
const RN_APPS = ['apps/driver-app', 'apps/owner-app'] as const;

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts']);
const SKIP_DIRS = new Set(['node_modules', '.expo', 'dist', 'ios', 'android', '.turbo', 'coverage']);

interface PkgJson {
  dependencies?: Record<string, string>;
  exports?: Record<string, unknown>;
}

function readPkg(relDir: string): PkgJson | null {
  const p = join(repoRoot, relDir, 'package.json');
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as PkgJson) : null;
}

function workspaceDirFor(pkgName: string): string | null {
  const leaf = pkgName.replace('@fleet/', '');
  for (const base of ['packages', 'apps', 'workers']) {
    if (existsSync(join(repoRoot, base, leaf, 'package.json'))) return join(base, leaf);
  }
  return null;
}

function sourceFiles(absDir: string, acc: string[] = []): string[] {
  if (!existsSync(absDir)) return acc;
  for (const entry of readdirSync(absDir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(absDir, entry);
    if (statSync(abs).isDirectory()) sourceFiles(abs, acc);
    else if (SOURCE_EXT.has(extname(entry))) acc.push(abs);
  }
  return acc;
}

// Real import specifiers only: from/import(...)/require forms, never prose.
// The capture is bound to a const and guarded rather than indexed inline:
// noUncheckedIndexedAccess types m[1] as string | undefined and cannot know the
// pattern has a capture group. The house pattern for this (t63 literal-guard,
// t15 assignment-audit) is a guarded bind, not a ?? fallback -- a fallback
// would satisfy tsc by adding a branch no input can reach, which the coverage
// gate then reports forever and no honest test can close. Here the guard is
// honest: a pattern edit that drops the group would take it.
function specifiersIn(text: string, dep: string): string[] {
  const found: string[] = [];
  const re = new RegExp(
    '(?:from|import|require)\\s*\\(?\\s*[\'"](' + dep.replace('/', '\\/') + '(?:\\/[^\'"]+)?)[\'"]',
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const captured = m[1];
    if (captured) found.push(captured);
  }
  return found;
}

interface Case {
  app: string;
  dep: string;
  dir: string;
  subpath: string;
}

function importedSubpaths(): Case[] {
  const out: Case[] = [];
  const seen = new Set<string>();
  for (const app of RN_APPS) {
    const pkg = readPkg(app);
    if (!pkg) continue;
    const deps = Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith('@fleet/'));
    if (deps.length === 0) continue;
    for (const file of sourceFiles(join(repoRoot, app))) {
      const text = readFileSync(file, 'utf8');
      for (const dep of deps) {
        for (const spec of specifiersIn(text, dep)) {
          const dir = workspaceDirFor(dep);
          if (!dir) continue;
          const subpath = spec === dep ? '.' : '.' + spec.slice(dep.length);
          const key = app + '|' + dep + '|' + subpath;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ app, dep, dir, subpath });
        }
      }
    }
  }
  return out;
}

const CASES = importedSubpaths();

function conditionsFor(dir: string, subpath: string): string[] | null {
  const target = readPkg(dir)?.exports?.[subpath];
  if (typeof target !== 'object' || target === null) return null;
  return Object.keys(target as Record<string, unknown>);
}

describe('React Native workspace dependency resolution', () => {
  it('discovers @fleet/* subpaths imported by RN apps', () => {
    expect(CASES.length).toBeGreaterThan(0);
  });

  it.each(CASES)('$dep ($subpath) in $app is declared in exports', ({ dep, dir, subpath }) => {
    const exportsMap = readPkg(dir)?.exports;
    expect(exportsMap, dep + ' declares no exports field').toBeTruthy();
    if (exportsMap === undefined) return;
    expect(
      Object.keys(exportsMap),
      dep + ' does not export ' + subpath + ' -- the import cannot resolve',
    ).toContain(subpath);
  });

  it.each(CASES)('$dep ($subpath) in $app is Metro-resolvable', ({ dep, dir, subpath }) => {
    const conditions = conditionsFor(dir, subpath);
    if (conditions === null) return;
    expect(
      conditions.includes('react-native') || conditions.includes('default'),
      dep + subpath + ' offers [' + conditions.join(', ') + ']. Metro asserts the union of ' +
        'default/import/require plus its condition names, so a subpath needs either a ' +
        'react-native condition or a default fallback; this offers neither and cannot bundle.',
    ).toBe(true);
  });

  it.each(CASES)('$dep ($subpath) in $app resolves RN to source', ({ dep, dir, subpath }) => {
    const target = readPkg(dir)?.exports?.[subpath];
    if (typeof target !== 'object' || target === null) return;
    const rn = (target as Record<string, unknown>)['react-native'];
    if (rn === undefined) return;
    expect(typeof rn, dep + subpath + ': react-native must be a string').toBe('string');
    const rnPath = rn as string;
    expect(
      rnPath.includes('/dist/'),
      dep + subpath + ': react-native points into dist (' + rnPath + '). dist requires a build ' +
        'on the EAS machine -- the stale-allowlist failure this guard exists to prevent.',
    ).toBe(false);
    expect(
      existsSync(join(repoRoot, dir, rnPath)),
      dep + subpath + ': react-native target does not exist: ' + rnPath,
    ).toBe(true);
  });

  it.each(CASES)('$dep ($subpath) in $app has no import beside react-native', ({ dep, dir, subpath }) => {
    const conditions = conditionsFor(dir, subpath);
    if (conditions?.includes('react-native') !== true) return;
    expect(
      conditions,
      dep + subpath + ' offers both react-native and import. Per facebook/metro#1278 Metro may ' +
        'select import regardless of order, resolving to dist. Remove import from RN subpaths.',
    ).not.toContain('import');
  });

  it.each(CASES)('$dep ($subpath) in $app puts types first', ({ dep, dir, subpath }) => {
    const conditions = conditionsFor(dir, subpath);
    if (conditions?.includes('types') !== true) return;
    expect(
      conditions.indexOf('types'),
      dep + subpath + ': types must be the first condition (publint EXPORTS_TYPES_SHOULD_BE_FIRST)',
    ).toBe(0);
  });
});
