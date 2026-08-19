// scripts/expo-doctor.ts
// THE INSTRUMENT THAT ANSWERS EXPO DEPENDENCY QUESTIONS, wired so it runs.
//
// WHY THIS EXISTS. //#knip reported expo-system-ui as an UNLISTED dependency
// of both Expo apps, inferred from userInterfaceStyle:"automatic" in app.json.
// The inference is reasonable and the conclusion was WRONG: expo-doctor, run
// against the same tree, reports 19/20 checks passing with no missing peer
// dependency at all.
//
// knip answers a JS IMPORT-GRAPH question, and Expo native-module correctness
// is not one. Since SDK 54 autolinking links modules from an app's direct and
// nested dependencies rather than scanning node_modules, so presence,
// declaration and version-match are decided by rules only Expo's tooling
// models. Asking a bundler-graph tool is asking the wrong oracle.
//
// WHAT THE RIGHT ORACLE FOUND, first run: 26 packages drifted from the SDK
// pins across the two apps, including expo itself and react-native. Invisible
// to knip, eslint, tsc and every gate this repo owns, because nothing asked.
//
// ---- THE VERSION IS PINNED, NOT FLOATING (2026-08-19) ----
//
// THE FIRST REVISION OF THIS FILE SHIPPED A SUPPLY-CHAIN HOLE, and argued for
// it: it ran `npx --yes expo-doctor@latest`, reasoning that a pinned copy
// would answer with stale rules about a newer SDK. That trade is backwards.
// @latest resolves at EXECUTION TIME to whatever was published to the registry
// moments earlier, so a typosquat, a maintainer account takeover or an
// unreviewed breaking change executes inside the gate with no lockfile entry,
// no integrity hash and no review -- exactly how 84 malicious @tanstack
// versions shipped in May 2026. 2026 guidance is unanimous: pin exact
// versions, avoid floating tags, and let the lockfile be the trust boundary.
//
// WORSE, IT BYPASSED CONTROLS THIS REPO ALREADY OWNS. pnpm-workspace.yaml
// enforces a minimumReleaseAge cooldown and every install prints "Lockfile
// passes supply-chain policies" -- and a bare npx fetch is subject to neither,
// because nothing it downloads is in the lockfile at all.
//
// THE STALENESS OBJECTION IS ANSWERED BY EXPO ITSELF. expo-doctor publishes
// SDK-ALIGNED dist-tags (sdk-55 -> 1.18.24), so the correct version for an
// SDK is a fact, not a guess -- and pinning it exactly is both current AND
// verifiable. Staleness is then handled the way every other tool version here
// is handled: a reviewable bump, the same contract //#bump:turbo enforces.
//
// So expo-doctor is a PINNED devDependency of each Expo app (exact, no caret)
// and is invoked through pnpm exec, which resolves from node_modules and makes
// no network call. The earlier "Command not found" that pushed the first
// revision toward npx was not an obstacle: it was the tool telling us it had
// never been declared.

/** The workspaces that are Expo apps. Derived from which packages declare the
 *  expo dependency, not from intuition; ops-web is Next.js and has no business
 *  here. */
export const EXPO_APPS: readonly string[] = Object.freeze([
  'apps/driver-app',
  'apps/owner-app',
]);

/** The exact expo-doctor version each Expo app pins.
 *
 *  Matches Expo's own sdk-55 dist-tag, so it is the version Expo publishes AS
 *  correct for this SDK -- current by construction rather than by trusting the
 *  registry at execution time. Asserted against the manifests by
 *  expo-doctor-pin.guard.test.ts, so a drift between this constant and what is
 *  actually installed fails a test rather than silently running a different
 *  tool than the one reviewed. */
export const EXPO_DOCTOR_VERSION = '1.18.24';

/** Invoke the LOCKED, LOCAL binary.
 *
 *  No version specifier and no registry fetch: pnpm exec resolves expo-doctor
 *  from node_modules, where the lockfile pinned it with an integrity hash and
 *  the workspace cooldown policy already vetted it. A floating @latest here
 *  would execute registry content that no lockfile, no review and no policy
 *  ever saw. */
export function doctorArgs(): readonly string[] {
  return ['expo-doctor'];
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
 *  dependency versions across the Frozen Stack. Blocking every push on 26 patch
 *  drifts would make the gate the thing people work around. */
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
