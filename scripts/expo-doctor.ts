// scripts/expo-doctor.ts
// THE INSTRUMENT THAT ANSWERS EXPO DEPENDENCY QUESTIONS, wired so it runs.
//
// WHY THIS EXISTS. //#knip reported expo-system-ui as an UNLISTED dependency
// of both Expo apps, inferred from userInterfaceStyle:"automatic" in app.json.
// The inference is reasonable and the conclusion was WRONG: expo-doctor, run
// against the same tree, reports 19/20 checks passing with no missing peer
// dependency at all.
//
// The lesson is not that knip is bad. It is that knip answers a JS IMPORT-GRAPH
// question, and Expo native-module correctness is not an import-graph question.
// Since SDK 54, Expo autolinking "will link according to your app's direct and
// nested dependencies, rather than scanning your node_modules folders" -- so
// whether a native module is present, declared and correctly versioned is
// decided by rules only Expo's own tooling models. Asking a bundler-graph tool
// is asking the wrong oracle, and acting on its answer would have added a
// dependency nothing needs.
//
// WHAT THE RIGHT ORACLE ACTUALLY FOUND, first run: 15 packages out of date
// against the installed SDK, including expo itself (55.0.26 vs ~55.0.29) and
// react-native (0.83.6 vs 0.83.10). None of that is visible to knip, to
// eslint, to tsc or to any gate this repo owns. It accumulated silently
// because NOTHING ASKED.
//
// A PRIOR SESSION ALREADY PROVED THE VALUE and then let it lapse: expo-doctor
// was run by hand in June, found "Missing peer dependency: expo-constants,
// Required by: expo-router", and that was fixed -- expo-constants is declared
// today. The check was real once, as a human action, and nothing made it
// repeat. That is the decorative-control shape this repo has now closed five
// times over.
//
// GRADED, NOT BOOLEAN, and this is the load-bearing design decision. A version
// drift and a MISSING NATIVE PEER are not the same severity: the first is
// hygiene the team schedules, the second is documented by Expo as "your app may
// crash outside of Expo Go". Collapsing them into one exit code forces a
// choice between a gate that is born red on 15 patch drifts -- which teaches
// everyone to bypass it, the failure //#typecheck:scripts and //#knip both
// document -- and no gate at all. Separating them lets the crash-class fail the
// push today while drift reports without blocking.

/** The workspaces that are Expo apps. Derived from which packages declare the
 *  expo dependency, not from intuition; ops-web is Next.js and has no business
 *  here. */
export const EXPO_APPS: readonly string[] = Object.freeze([
  'apps/driver-app',
  'apps/owner-app',
]);

/** Invoke the PUBLISHED doctor, pinned to latest by design.
 *
 *  expo-doctor is deliberately NOT a declared devDependency. Expo ships it as a
 *  standalone CLI whose checks track the SDK, and its own advice is to run
 *  expo-doctor@latest -- a version pinned in our lockfile would answer with
 *  last quarter's rules about this quarter's SDK, which is the stale-instrument
 *  failure //#prod:db-url exists to prevent. --yes suppresses the install
 *  prompt so this can never block on stdin, the defect that hung
 *  //#secrets:baseline for eight hours. */
export function doctorArgs(): readonly string[] {
  return ['--yes', 'expo-doctor@latest'];
}

/** What one doctor run reported. */
export interface DoctorSummary {
  /** Checks that passed. */
  readonly passed: number;
  /** Checks that ran. */
  readonly total: number;
  /** A peer dependency Expo says must be installed directly. CRASH CLASS. */
  readonly missingPeers: readonly string[];
  /** Packages whose version does not match the installed SDK. HYGIENE. */
  readonly outdated: number;
}

/** Read a doctor run from its stdout.
 *
 *  TEXT, not JSON: expo-doctor has no machine-readable output mode, so the
 *  parse is anchored on the two sentences it prints verbatim. Anchoring on
 *  Expo's own wording rather than on layout means a cosmetic reformat does not
 *  silently zero the counts -- and a parse that yields zero from real output is
 *  the confident zero this repo refuses everywhere, so the verdict below treats
 *  an unreadable summary as a failure rather than a pass. */
export function parseDoctorSummary(stdout: string): DoctorSummary {
  const ratio = /([0-9]+)\/([0-9]+) checks passed/.exec(stdout);
  const outdated = /([0-9]+) packages? out of date/.exec(stdout);
  const missingPeers: string[] = [];
  for (const line of stdout.split('\n')) {
    const m = /Missing peer dependency:\s*(\S+)/.exec(line);
    if (m?.[1] !== undefined) missingPeers.push(m[1]);
  }
  return {
    passed: ratio?.[1] !== undefined ? Number(ratio[1]) : 0,
    total: ratio?.[2] !== undefined ? Number(ratio[2]) : 0,
    missingPeers,
    outdated: outdated?.[1] !== undefined ? Number(outdated[1]) : 0,
  };
}

export const DOCTOR_EXIT = {
  ok: 0,
  /** A native peer dependency is missing. Expo documents this as a crash
   *  outside Expo Go, so it BLOCKS. */
  missingPeer: 1,
  /** The doctor could not be read -- a broken instrument is never a pass. */
  unreadable: 3,
} as const;

/** The verdict over every Expo app.
 *
 *  FAILS CLOSED, with unreadable DOMINATING: a run whose output could not be
 *  parsed cannot honestly report either a pass or a specific missing peer.
 *
 *  VERSION DRIFT DELIBERATELY DOES NOT BLOCK. It is reported by the driver and
 *  left to a scheduled bump, because the fix (expo install --check) rewrites
 *  dependency versions across the Frozen Stack -- which mobile-native-bundle-
 *  config.test.ts and eas-config.test.ts pin on purpose. Blocking every push on
 *  15 patch drifts would make the gate the thing people work around. */
export function doctorVerdict(summaries: readonly DoctorSummary[]): number {
  if (summaries.length === 0) return DOCTOR_EXIT.unreadable;
  if (summaries.some((s) => s.total === 0)) return DOCTOR_EXIT.unreadable;
  return summaries.some((s) => s.missingPeers.length > 0)
    ? DOCTOR_EXIT.missingPeer
    : DOCTOR_EXIT.ok;
}

/** The operator line for one app. Names the app and the finding, because
 *  "expo-doctor failed" is not actionable and this gate blocks a push. */
export function describeDoctor(app: string, s: DoctorSummary): string {
  if (s.total === 0) return app + ': UNREADABLE -- expo-doctor output could not be parsed';
  if (s.missingPeers.length > 0) {
    return app + ': MISSING NATIVE PEER (' + s.missingPeers.join(', ')
      + ') -- Expo documents this as a crash outside Expo Go. Install it with'
      + ' expo install, not pnpm add: native peers must be declared directly.';
  }
  const drift = s.outdated > 0
    ? ' -- ' + String(s.outdated) + ' package(s) drifted from the SDK pins (reported, not blocking)'
    : '';
  return app + ': ' + String(s.passed) + '/' + String(s.total) + ' checks passed' + drift;
}
