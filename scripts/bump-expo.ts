// FleetManagement/scripts/bump-expo.ts
// Root task: align every Expo app's dependencies with the versions the
// INSTALLED SDK expects -- the reviewable bump //#expo:doctor defers to.
//
// WHY THIS EXISTS. //#expo:doctor reports drift and deliberately does not
// block on it, because the fix rewrites dependency versions across the Frozen
// Stack and a gate born red on 26 patch drifts is one everybody works around.
// But "deferred to a reviewable bump" only means something if the bump is a
// CAPTURED OP. It was not: the only way to do it was `expo install --check`
// typed by hand -- the uncaptured idiom the rule forbids, and the same shape
// //#bump:turbo and //#bump:pnpm were created to retire for their toolchains.
//
// THE VERSIONS ARE EXPO'S, NOT OURS. bump:turbo takes a target version because
// turbo is one package and the operator chooses when to move. Here the correct
// version of every Expo package is a FACT the installed SDK already knows, and
// inventing one would reintroduce exactly the mismatch expo-doctor exists to
// find. So this op takes NO version argument: it reads the drift table
// expo-doctor prints -- name, expected, found -- and applies the EXPECTED
// column verbatim, range operator included.
//
// That also means it cannot silently upgrade the SDK itself beyond what is
// installed: every number it writes came from the doctor, and re-running the
// doctor afterwards is the verification.
//
// PURE CORE / THIN DRIVER, the bump-turbo split: planExpoBump and
// applyManifestVersions are total functions over strings, so every branch is
// unit-testable without a filesystem or a network. The driver reads, writes and
// spawns, and owns no decisions.
//
// CJS constraint (root package has no type:module, tsx transpiles CJS): NO
// top-level await -- synchronous execFileSync + main(): number +
// process.exit(main()), matching bump-turbo.ts and bump-pnpm.ts.
//
// Related files:
//   - scripts/expo-doctor.ts        (EXPO_APPS, parseDriftTable -- the oracle)
//   - scripts/expo-doctor-cli.ts    (//#expo:doctor, which reports the drift)
//   - turbo.jsonc                   (//#bump:expo task)
//   - package.json                  (bump:expo script)
// Run: pnpm exec turbo run bump:expo [-- --execute]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPO_APPS, doctorArgs, parseDriftTable, type DriftedPackage } from './expo-doctor.js';

const NL = String.fromCharCode(10);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const EXPO_BUMP_EXIT = {
  ok: 0,
  /** A manifest could not be rewritten as planned -- never a partial write. */
  failed: 1,
  /** Nothing drifted; the apps already match the SDK. */
  nothingToDo: 3,
} as const;

/** What one app's bump would change. */
export interface ExpoBumpPlan {
  readonly app: string;
  readonly changes: readonly DriftedPackage[];
}

/** Decide what to change for one app.
 *
 *  A row is actionable only when the manifest actually DECLARES the package:
 *  expo-doctor also reports drift for transitive packages no manifest owns, and
 *  writing those in would create a phantom direct dependency. Filtering here
 *  rather than in the driver keeps the decision testable. */
export function planExpoBump(
  manifestText: string,
  drifted: readonly DriftedPackage[],
): readonly DriftedPackage[] {
  return drifted.filter((row) => manifestText.includes('"' + row.name + '": "'));
}

/** Rewrite one manifest so every planned package carries its expected spec.
 *
 *  EXACT-OCCURRENCE CONTRACT, the bump-turbo guard: each package name must
 *  appear as a declared key exactly once. Zero means the plan disagrees with
 *  the file; more than one means dependencies and devDependencies both declare
 *  it and a blind replace would rewrite the wrong entry. Either way this
 *  THROWS rather than writing a manifest nobody predicted.
 *
 *  IDEMPOTENT: re-running with the same expectations yields identical text, so
 *  a second run is a verifiable no-op rather than a silent rewrite. */
export function applyManifestVersions(
  manifestText: string,
  changes: readonly DriftedPackage[],
): string {
  let out = manifestText;
  for (const row of changes) {
    const needle = '"' + row.name + '": "';
    const count = out.split(needle).length - 1;
    if (count !== 1) {
      throw new Error(
        'bump:expo refused: expected exactly one declaration of ' +
          row.name +
          ', found ' +
          String(count),
      );
    }
    const start = out.indexOf(needle) + needle.length;
    const end = out.indexOf('"', start);
    out = out.slice(0, start) + row.expected + out.slice(end);
  }
  return out;
}

/* v8 ignore start -- side-effecting driver; every decision above is unit-tested */
function line(s: string): void {
  process.stdout.write('[bump:expo] ' + s + NL);
}
function errline(s: string): void {
  process.stderr.write('[bump:expo] ' + s + NL);
}

function driftFor(app: string): readonly DriftedPackage[] {
  const cwd = resolve(ROOT, app);
  if (!existsSync(cwd)) return [];
  const run = execFileSync('pnpm', ['exec', ...doctorArgs()], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // expo-doctor exits non-zero whenever any check fails, including for drift
    // alone, so a throw here is expected and its stdout is the payload.
  } as never) as unknown as string;
  return parseDriftTable(run);
}

function driftForSafe(app: string): readonly DriftedPackage[] {
  try {
    return driftFor(app);
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    return parseDriftTable((e.stdout ?? '') + NL + (e.stderr ?? ''));
  }
}

function mainBumpExpo(): number {
  // DRY-RUN BY DEFAULT, matching //#deps:reconcile, //#worktree:preserve and
  // every repair:* task: --execute is the only consent, so an accidental
  // invocation can never rewrite a manifest.
  const execute = process.argv.includes('--execute');
  const plans: ExpoBumpPlan[] = [];

  for (const app of EXPO_APPS) {
    const manifestPath = resolve(ROOT, app, 'package.json');
    if (!existsSync(manifestPath)) {
      errline(app + ': package.json not found');
      return EXPO_BUMP_EXIT.failed;
    }
    const text = readFileSync(manifestPath, 'utf8');
    const changes = planExpoBump(text, driftForSafe(app));
    plans.push({ app, changes });
    line(app + ': ' + String(changes.length) + ' declared package(s) drifted');
    for (const c of changes) line('  ' + c.name + '  ' + c.found + ' -> ' + c.expected);
  }

  const total = plans.reduce((n, p) => n + p.changes.length, 0);
  if (total === 0) {
    line('every Expo app already matches its SDK -- nothing to do.');
    return EXPO_BUMP_EXIT.nothingToDo;
  }

  if (!execute) {
    line('DRY RUN -- no file written. Re-run with -- --execute to apply.');
    return EXPO_BUMP_EXIT.ok;
  }

  for (const plan of plans) {
    if (plan.changes.length === 0) continue;
    const manifestPath = resolve(ROOT, plan.app, 'package.json');
    const before = readFileSync(manifestPath, 'utf8');
    let after: string;
    try {
      after = applyManifestVersions(before, plan.changes);
    } catch (e) {
      errline((e as Error).message);
      return EXPO_BUMP_EXIT.failed;
    }
    writeFileSync(manifestPath, after);
    line(plan.app + ': rewrote ' + String(plan.changes.length) + ' spec(s)');
  }

  line('running pnpm install to update the lockfile ...');
  execFileSync('pnpm', ['install', '--lockfile-only'], { stdio: 'inherit' });
  line('lockfile updated.');
  line('NEXT: run //#expo:doctor to verify the drift is gone, then the build gate.');
  return EXPO_BUMP_EXIT.ok;
}

if (process.argv[1]?.endsWith('bump-expo.ts') ?? false) {
  process.exit(mainBumpExpo());
}
/* v8 ignore stop */
