// FleetManagement/scripts/bump-turbo.ts
// Root task: bump the repo-wide turbo devDependency version.
//
// Why this exists (2026 rule): every project op is a registered Turbo task or
// committed root script, never a throw-away CLI. Bumping turbo was a hand-edit
// of the devDependency spec plus a bare pnpm install -- the uncaptured idiom the
// rule forbids, and one that drifts (wrong range operator, forgotten lockfile
// update, no verification the runtime matches the pin). //#bump:turbo captures
// it, the sibling of //#bump:pnpm (scripts/bump-pnpm.ts).
//
// THE HALF IT USED TO FORGET, 2026-08-18. A turbo bump touches THREE files, and
// this script owned two. pnpm-workspace.yaml carries seven
// minimumReleaseAgeExclude entries -- the runner plus six platform binaries --
// exempting turbo from pnpm's release-age quarantine, and they were maintained
// by hand. PR #602 raised the pin to ^2.10.10 and raised the floor in
// turbo-version-floor.guard.test.ts in the same commit, exactly as that guard
// demands, and left all seven exclude lines at 2.10.9. Nothing noticed: the
// only guard over this pin reads package.json. PR #606 added them by hand a day
// later, which is the treadmill -- 2.10.11 would repeat it.
//
// It survived CI because the failure is PER-HOST. pnpm resolves the optional
// platform binary for the machine it runs on, so a missing @turbo/darwin-arm64
// entry is invisible on a Linux runner and fails only on a Mac whose policy
// cache is cold while the version is inside the age window.
//
// So the exclude list is now DERIVED here, from the same version the spec
// rewrite uses, and turbo-release-age.guard.test.ts asserts the two files agree
// -- the pattern //#env:recipients already uses to keep .sops.yaml from drifting
// out of .age-recipients: generate, never ask a human to remember.
//
// ORDER MATTERS: the exclude list is rewritten BEFORE pnpm install runs. The
// install resolves the new version against the policy in pnpm-workspace.yaml,
// so writing the exemption afterwards would let the install fail against a
// policy this very script was about to fix.
//
// CJS constraint (root package has no type:module, tsx transpiles CJS): NO
// top-level await -- synchronous execFileSync + main(): number +
// process.exit(main()), the exact sibling pattern of bump-pnpm.ts.
//
// Related files:
//   - turbo.jsonc                          (//#bump:turbo task)
//   - package.json                         (bump:turbo script; the pin)
//   - pnpm-workspace.yaml                  (minimumReleaseAgeExclude)
//   - scripts/turbo-release-age.ts         (the exclude-line rules, pure)
//   - scripts/turbo-release-age.guard.test.ts (asserts pin == exclude)
//   - scripts/turbo-version-floor.guard.test.ts (asserts pin >= floor)
// Run: pnpm exec turbo run bump:turbo -- <version>
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  TURBO_PLATFORM_PACKAGES,
  excludeLineFor,
  versionsInExcludeLine,
  withTurboVersion,
} from './turbo-release-age.js';

export const WORKSPACE_FILE = 'pnpm-workspace.yaml';

export interface TurboBumpPlan {
  readonly newSpec: string;
  readonly noop: boolean;
}

// The slice of the root manifest this script depends on. `turbo` is declared as
// a NAMED optional property, not Record<string, string>: Record is the
// dynamic-key form, TS4111 rejects dot access on an index signature, and
// bracket access would compile while leaving the real weakness -- nothing
// constrains the key, so a typo reads undefined and this script blames the
// manifest for a mistake in this file. A named optional property makes a
// misspelling a compile error.
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

/** Rewrite every turbo exclude entry to carry `version`. PURE over the file
 *  text, so the whole rewrite is unit-testable without touching a filesystem --
 *  the property that was missing when this half of the bump lived in a human's
 *  memory.
 *
 *  EDITS IN PLACE rather than regenerating the block: the file interleaves
 *  hand-written comments with entries, and rendering it wholesale would delete
 *  every rationale it carries. Each turbo line is replaced where it sits; a
 *  package with no line at all is APPENDED at the end of the block.
 *
 *  IDEMPOTENT by construction -- withTurboVersion is a no-op when the version is
 *  already present, so re-running at the same version leaves the file
 *  byte-identical and the dirty-tree refusal below stays meaningful. */
export function rewriteExcludeBlock(text: string, version: string): string {
  const lines = text.split('\n');
  const seen = new Set<string>();
  let lastTurboIndex = -1;

  const rewritten = lines.map((line, index) => {
    const body = line.trim().replace(/^-\s*/, '').replace(/^'|'$/g, '');
    const pkg = TURBO_PLATFORM_PACKAGES.find((p) => body.startsWith(p + '@'));
    if (pkg === undefined) return line;
    seen.add(pkg);
    lastTurboIndex = index;
    const versions = withTurboVersion(versionsInExcludeLine(line), version);
    // Indentation is preserved from the line being replaced rather than
    // hardcoded: the block is a YAML sequence and a changed indent would
    // silently move the entry out of it.
    const indent = line.slice(0, line.indexOf('-'));
    return indent + '- ' + excludeLineFor(pkg, versions);
  });

  const absent = TURBO_PLATFORM_PACKAGES.filter((p) => !seen.has(p));
  if (absent.length === 0 || lastTurboIndex < 0) return rewritten.join('\n');

  const anchor = rewritten[lastTurboIndex] ?? '';
  const indent = anchor.slice(0, anchor.indexOf('-'));
  const added = absent.map((p) => indent + '- ' + excludeLineFor(p, [version]));
  rewritten.splice(lastTurboIndex + 1, 0, ...added);
  return rewritten.join('\n');
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

  const version = plan.newSpec.replace(/^[\^~]/, '');

  // BEFORE the install, not after: pnpm resolves the new version against the
  // release-age policy in this very file, so a later rewrite would let the
  // install fail against a policy this script was about to fix.
  const workspaceRaw = readFileSync(WORKSPACE_FILE, 'utf8');
  const workspaceNext = rewriteExcludeBlock(workspaceRaw, version);
  if (workspaceNext === workspaceRaw) {
    out('release-age excludes already carry ' + version + ' -- unchanged.');
  } else {
    writeFileSync(WORKSPACE_FILE, workspaceNext);
    out('added ' + version + ' to the release-age excludes for all '
      + String(TURBO_PLATFORM_PACKAGES.length) + ' turbo packages.');
  }

  out('running pnpm install to update the lockfile ...');
  const installOut = run('pnpm', ['install', '--lockfile-only']);
  if (installOut !== '') process.stdout.write(installOut + nl);
  out('lockfile updated for turbo ' + version + '.');
  out('NEXT: raise FLOOR in scripts/turbo-version-floor.guard.test.ts in THIS commit,');
  out('then run the build gate.');
  return 0;
}

// Only run main() when invoked directly, so the test can import the pure core
// without triggering the git/pnpm side effects.
if (process.argv[1]?.endsWith('bump-turbo.ts')) {
  process.exit(main());
}
