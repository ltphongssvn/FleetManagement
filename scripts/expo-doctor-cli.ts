// scripts/expo-doctor-cli.ts
// Driver for //#expo:doctor -- run Expo's own dependency oracle against every
// Expo app and report a verdict that fails closed.
//
// WHY THIS EXISTS. //#knip reported expo-system-ui as an unlisted dependency of
// both Expo apps, inferred from userInterfaceStyle:"automatic". expo-doctor,
// run against the same tree, reported 19/20 with NO missing peer. knip answers
// an import-graph question; Expo native-module correctness is decided by
// autolinking rules only Expo's tooling models -- since SDK 54 a module links
// from an app's direct and nested dependencies rather than a node_modules scan.
// Acting on the wrong oracle would have added a dependency nothing needs.
//
// What the right oracle DID find: 15 packages drifted from the SDK pins,
// including expo and react-native. Invisible to knip, eslint, tsc and every
// gate this repo owns, because nothing asked.
//
// Every decision lives in expo-doctor.ts, which is pure and unit-tested against
// REAL output fixtures; this file learns facts and prints them.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOCTOR_EXIT,
  EXPO_APPS,
  describeDoctor,
  doctorArgs,
  doctorVerdict,
  parseDoctorSummary,
  type DoctorSummary,
} from './expo-doctor.js';

const NL = String.fromCharCode(10);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* v8 ignore start -- side-effecting driver; every decision above and in
   expo-doctor.ts is unit-tested */
function out(s: string): void { process.stdout.write('[expo:doctor] ' + s + NL); }
function errline(s: string): void { process.stderr.write('[expo:doctor] ' + s + NL); }

/** Run the doctor in ONE app. Never throws: a failure becomes a summary the
 *  verdict can reason about, because an exception here would exit with a stack
 *  trace and no report -- and a gate that crashes tells a caller nothing. */
function doctorFor(app: string): DoctorSummary {
  const cwd = resolve(ROOT, app);
  if (!existsSync(cwd)) {
    errline(app + ': directory not found');
    return { passed: 0, total: 0, missingPeers: [], outdated: 0 };
  }
  // npx, not pnpm exec: expo-doctor is deliberately not a declared dependency
  // (its checks track the SDK, so a pinned copy answers with stale rules), and
  // `pnpm exec expo-doctor` fails with "Command not found" -- verified.
  const run = spawnSync('npx', [...doctorArgs()], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (run.error !== undefined) {
    errline(app + ': could not spawn npx -- ' + run.error.message);
    return { passed: 0, total: 0, missingPeers: [], outdated: 0 };
  }
  // The doctor exits NON-ZERO whenever any check fails, including for drift
  // alone, so its exit code cannot be the verdict -- the summary is parsed
  // from stdout and classified by severity instead. stderr is folded in
  // because the CLI splits its output across both streams.
  return parseDoctorSummary(run.stdout + NL + run.stderr);
}

function mainExpoDoctor(): number {
  out('checking Expo apps: ' + EXPO_APPS.join(', '));
  const summaries = EXPO_APPS.map((app) => {
    const s = doctorFor(app);
    out(describeDoctor(app, s));
    return s;
  });

  const verdict = doctorVerdict(summaries);
  if (verdict === DOCTOR_EXIT.ok) {
    const drift = summaries.reduce((n, s) => n + s.outdated, 0);
    if (drift > 0) {
      out('OK. ' + String(drift) + ' package(s) drift from the SDK pins --');
      out('reported, NOT blocking: the fix rewrites versions the Frozen Stack');
      out('tests pin, so it belongs in its own reviewable bump.');
    } else {
      out('OK. every Expo app matches its SDK.');
    }
  } else if (verdict === DOCTOR_EXIT.missingPeer) {
    errline('BLOCKED: a native peer dependency is missing.');
    errline('Expo documents this as a crash OUTSIDE Expo Go, so it is not');
    errline('deferrable. Install it with expo install, never pnpm add: native');
    errline('peers must be declared directly and version-matched to the SDK.');
  } else {
    errline('CANNOT VERIFY: expo-doctor output could not be read.');
    errline('A broken instrument is NOT a clean bill of health.');
  }
  return verdict;
}

const isMain = process.argv[1]?.endsWith('expo-doctor-cli.ts') ?? false;
if (isMain) {
  process.exit(mainExpoDoctor());
}
/* v8 ignore stop */
