// FleetManagement/scripts/bump-turbo.ts
// Root task: bump the repo-wide turbo devDependency version.
//
// Why this exists (2026 rule): every project op is a registered Turbo task or
// committed root script, never a throw-away CLI. Bumping turbo was a hand-edit
// of the devDependency spec plus a bare pnpm install -- the uncaptured idiom the
// rule forbids, and one that drifts (wrong range operator, forgotten lockfile
// update, no verification the runtime matches the pin). //#bump:turbo captures
// it, the sibling of //#bump:pnpm (scripts/bump-pnpm.ts). turbo differs from
// pnpm: it is an ordinary devDependency, not the corepack packageManager pin, so
// the correct bump is a spec rewrite + pnpm install (which updates the lockfile),
// not corepack use.
//
// Unlike bump-pnpm.ts (an untested side-effecting script), the version logic is a
// PURE core (planTurboBump) unit-tested with zero I/O -- the close-worktree /
// host-gate house pattern. The thin main() does the git-clean refusal, the file
// rewrite, and pnpm install.
//
// CJS constraint (root package has no type:module, tsx transpiles CJS): NO
// top-level await -- synchronous execFileSync + main(): number +
// process.exit(main()), the exact sibling pattern of bump-pnpm.ts.
//
// Related files:
//   - turbo.jsonc  (//#bump:turbo task)
//   - package.json (bump:turbo script; the turbo devDependency this rewrites)
// Run: pnpm exec turbo run bump:turbo -- <version>
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

export interface TurboBumpPlan {
  readonly newSpec: string;
  readonly noop: boolean;
}

// The slice of the root manifest this script depends on. `turbo` is declared as
// a NAMED optional property, not Record<string, string>.
//
// WHY NOT Record (2026-08-08). The previous shape was
//   { devDependencies?: Record<string, string> }
// read as `pkg.devDependencies?.turbo`, which is TS4111 under
// noPropertyAccessFromIndexSignature: Record<string, string> is the DYNAMIC-key
// form, and dot access on an index signature is exactly what that flag rejects.
// Switching to `devDependencies?.['turbo']` would have compiled while leaving
// the real weakness in place -- nothing constrains the key, so a typo like
// ['turbi'] typechecks, reads undefined, and this script then prints
// "REFUSED: no turbo devDependency found in package.json", blaming the manifest
// for a mistake in this file.
//
// Naming the key is the fix, not the access syntax. An interface with a named
// optional property carries no index signature, so dot access is legal AND a
// misspelling is a compile error. Widening to Record<string, any> would have
// been the opposite move: it silences the compiler by discarding type safety.
// Other devDependencies are irrelevant here; this script reads exactly one.
interface RootManifestTurboSlice {
  readonly devDependencies?: { readonly turbo?: string };
}

// A semver range operator we know how to preserve across a bump. Anything else
// (workspace:, an empty string, a URL) is refused rather than guessed at.
const RANGE_PREFIXES = ['^', '~'] as const;

function splitSpec(spec: string): { prefix: string; version: string } {
  for (const p of RANGE_PREFIXES) {
    if (spec.startsWith(p)) return { prefix: p, version: spec.slice(p.length) };
  }
  return { prefix: '', version: spec };
}

const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;

// Pure: compute the new turbo spec from the current one and a requested version,
// preserving the range operator. Throws on a non-semver request or an
// unparseable current spec rather than writing junk into package.json.
export function planTurboBump(currentSpec: string, requestedVersion: string): TurboBumpPlan {
  const version = requestedVersion.startsWith('v') ? requestedVersion.slice(1) : requestedVersion;
  if (!SEMVER.test(version)) {
    throw new Error(
      'bump:turbo requires an exact semver version (e.g. 2.10.7), got: ' + requestedVersion,
    );
  }
  const { prefix, version: currentVersion } = splitSpec(currentSpec.trim());
  if (!SEMVER.test(currentVersion)) {
    throw new Error('bump:turbo cannot parse the current turbo spec: ' + currentSpec);
  }
  const newSpec = prefix + version;
  return { newSpec, noop: newSpec === currentSpec.trim() };
}

const nl = String.fromCharCode(10);
function out(s: string): void { process.stdout.write('[bump:turbo] ' + s + nl); }
function errline(s: string): void { process.stderr.write('[bump:turbo] ' + s + nl); }

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function currentTurboSpec(): string {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as RootManifestTurboSlice;
  return pkg.devDependencies?.turbo ?? 'NOT SET';
}

function main(): number {
  const requested = process.argv[2];
  if (requested === undefined || requested === '') {
    errline('REFUSED: a target version is required. Run: pnpm exec turbo run bump:turbo -- 2.10.7');
    return 1;
  }
  const dirty = run('git', ['status', '--porcelain']);
  if (dirty !== '') {
    errline('REFUSED: working tree not clean. Commit or stash first.');
    return 1;
  }
  const before = currentTurboSpec();
  if (before === 'NOT SET') {
    errline('REFUSED: no turbo devDependency found in package.json.');
    return 1;
  }
  out('current spec: ' + before);
  let plan: TurboBumpPlan;
  try {
    plan = planTurboBump(before, requested);
  } catch (e) {
    errline((e as Error).message);
    return 1;
  }
  if (plan.noop) {
    out('already at ' + before + ' -- nothing to do.');
    return 0;
  }
  const raw = readFileSync('package.json', 'utf8');
  const needle = '"turbo": "' + before + '"';
  if (raw.split(needle).length - 1 !== 1) {
    errline('REFUSED: expected exactly one turbo spec occurrence to rewrite, found a different count.');
    return 1;
  }
  writeFileSync('package.json', raw.replace(needle, '"turbo": "' + plan.newSpec + '"'));
  out('rewrote turbo spec: ' + before + ' -> ' + plan.newSpec);
  out('running pnpm install to update the lockfile ...');
  const installOut = run('pnpm', ['install', '--lockfile-only']);
  if (installOut !== '') process.stdout.write(installOut + nl);
  const version = plan.newSpec.replace(/^[\^~]/, '');
  out('lockfile updated for turbo ' + version + '. Run the build gate next.');
  return 0;
}

// Only run main() when invoked directly, so the test can import the pure core
// without triggering the git/pnpm side effects.
if (process.argv[1]?.endsWith('bump-turbo.ts')) {
  process.exit(main());
}
