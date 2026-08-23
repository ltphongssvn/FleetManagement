// scripts/expo-doctor.test.ts
// The rules that decide whether an Expo app's dependencies are sound.
//
// FIXTURES ARE REAL OUTPUT, not invented. The passing case is this repo's own
// driver-app run on 2026-08-19; the missing-peer case is the verbatim shape a
// June session hit here (expo-constants required by expo-router, since fixed).
// A parser tested against imagined input proves only that it matches the
// imagination -- the lesson the estate porcelain parser already records.
import { describe, it, expect } from 'vitest';
import {
  DOCTOR_EXIT,
  EXPO_APPS,
  describeDoctor,
  doctorArgs,
  doctorVerdict,
  parseDoctorSummary,
  parseDriftTable,
  type DoctorSummary,
} from './expo-doctor.js';

const NL = String.fromCharCode(10);

/** driver-app, 2026-08-19: 15 packages drifted, no missing peer. */
const DRIFTED = [
  '19/20 checks passed. 1 checks failed. Possible issues detected:',
  '✖ Check that packages match versions required by installed Expo SDK',
  'expo                   ~55.0.29  55.0.26',
  'react-native           0.83.10   0.83.6',
  '15 packages out of date.',
].join(NL);

/** The June shape: a native peer absent, which Expo calls a crash risk. */
const MISSING_PEER = [
  '18/19 checks passed. 1 checks failed. Possible issues detected:',
  '✖ Check that required peer dependencies are installed',
  'Missing peer dependency: expo-constants',
  'Required by: expo-router',
  'Your app may crash outside of Expo Go without this dependency.',
].join(NL);

const CLEAN = '20/20 checks passed. No issues detected!';

describe('EXPO_APPS names the Expo workspaces only', () => {
  it('covers both native apps', () => {
    expect([...EXPO_APPS].sort()).toEqual(['apps/driver-app', 'apps/owner-app']);
  });

  // ops-web is Next.js. Running expo-doctor there would be a category error,
  // the same shape as auditing a deploy tree for a standalone bundle.
  it('EXCLUDES ops-web, which is not an Expo app', () => {
    expect(EXPO_APPS.some((a) => a.includes('ops-web'))).toBe(false);
  });

  it('is frozen, so the target set cannot widen at runtime', () => {
    expect(Object.isFrozen(EXPO_APPS)).toBe(true);
  });
});

describe('doctorArgs runs the LOCKED, LOCAL binary', () => {
  // THE VULNERABILITY THIS REPLACES. The first revision returned
  // 'expo-doctor@latest' and was spawned through npx, with a comment arguing
  // that a pinned copy would answer with stale rules about a newer SDK. That
  // trade is backwards: @latest resolves at EXECUTION TIME to whatever the
  // registry served moments earlier, so a typosquat, a maintainer takeover or
  // an unreviewed breaking change runs inside a merge gate with no lockfile
  // entry, no integrity hash and no review. Two tests here asserted that
  // behaviour as a CONTRACT, which is how a vulnerability becomes load-bearing.
  it('carries NO version specifier at all', () => {
    for (const arg of doctorArgs()) {
      expect([arg, arg.includes('@')]).toEqual([arg, false]);
    }
  });

  // The staleness objection is answered by Expo itself: it publishes
  // SDK-ALIGNED dist-tags (sdk-55 -> 1.18.24), so the right version for an SDK
  // is a fact to pin, not a reason to trust the registry at run time.
  it('never names a floating tag', () => {
    const flat = doctorArgs().join(' ');
    expect(flat).not.toContain('latest');
    expect(flat).not.toContain('next');
  });

  // Just the binary: pnpm exec resolves it from node_modules, where the
  // lockfile pinned it with an integrity hash and the workspace cooldown and
  // trust policy already vetted it. --yes is gone with npx -- there is no
  // install prompt to suppress when nothing is being fetched.
  it('names exactly the local binary', () => {
    expect(doctorArgs()).toEqual(['expo-doctor']);
  });
});

describe('parseDoctorSummary reads real output', () => {
  it('reads the check ratio', () => {
    const s = parseDoctorSummary(DRIFTED);
    expect({ passed: s.passed, total: s.total }).toEqual({ passed: 19, total: 20 });
  });

  it('reads the out-of-date package count', () => {
    expect(parseDoctorSummary(DRIFTED).outdated).toBe(15);
  });

  it('finds NO missing peer in a drift-only run', () => {
    expect(parseDoctorSummary(DRIFTED).missingPeers).toEqual([]);
  });

  it('names the missing peer when one is reported', () => {
    expect(parseDoctorSummary(MISSING_PEER).missingPeers).toEqual(['expo-constants']);
  });

  it('reads a fully clean run', () => {
    const s = parseDoctorSummary(CLEAN);
    expect({ passed: s.passed, total: s.total, peers: s.missingPeers.length }).toEqual({
      passed: 20,
      total: 20,
      peers: 0,
    });
  });

  it('collects SEVERAL missing peers, not just the first', () => {
    const two = MISSING_PEER + NL + 'Missing peer dependency: react-native-worklets';
    expect(parseDoctorSummary(two).missingPeers).toEqual([
      'expo-constants',
      'react-native-worklets',
    ]);
  });

  // A parse that silently yields zero from real output is the confident zero
  // this repo refuses; total:0 is the signal the verdict treats as unreadable.
  it('yields total 0 for unparseable output, the unreadable signal', () => {
    expect(parseDoctorSummary('command not found').total).toBe(0);
  });

  it('yields total 0 for empty output', () => {
    expect(parseDoctorSummary('').total).toBe(0);
  });
});

/** driver-app, 2026-08-19, verbatim -- including the emoji header and the
 *  ragged column widths a real run produces. */
const DRIFT_TABLE = [
  '19/20 checks passed. 1 checks failed. Possible issues detected:',
  '\u2716 Check that packages match versions required by installed Expo SDK',
  '',
  '\ud83d\udd27 Patch version mismatches',
  'package                expected  found    ',
  '@expo/metro-runtime    ~55.0.12  55.0.11  ',
  'expo                   ~55.0.29  55.0.26  ',
  'expo-router            ~55.0.18  55.0.16  ',
  'react-native           0.83.10   0.83.6   ',
  '',
  '15 packages out of date.',
].join(NL);

describe('parseDriftTable reads what Expo EXPECTS', () => {
  const rows = parseDriftTable(DRIFT_TABLE);

  // Vacuity guard first: a parse that finds nothing would make every
  // assertion below trivially true.
  it('finds every drifted row', () => {
    expect(rows.length).toBe(4);
  });

  // The middle column is the point: it is Expo's own number for this SDK, so
  // a bump applies it rather than inventing a version.
  it('captures the EXPECTED spec with its range operator', () => {
    expect(rows.find((r) => r.name === 'expo')?.expected).toBe('~55.0.29');
  });

  it('captures the found version separately', () => {
    expect(rows.find((r) => r.name === 'expo')?.found).toBe('55.0.26');
  });

  // Scoped names must survive: @expo/metro-runtime is one of the drifted set.
  it('handles SCOPED package names', () => {
    expect(rows.find((r) => r.name === '@expo/metro-runtime')?.expected).toBe('~55.0.12');
  });

  // react-native is pinned EXACT (no operator) while expo carries ~; both are
  // Expo's choice and both must round-trip unchanged.
  it('preserves an EXACT pin with no range operator', () => {
    expect(rows.find((r) => r.name === 'react-native')?.expected).toBe('0.83.10');
  });

  // Header and prose lines must not parse as rows -- the failure that would
  // silently write "package" into a manifest.
  it('ignores the header and the summary prose', () => {
    expect(rows.some((r) => r.name === 'package')).toBe(false);
    expect(rows.some((r) => r.name.includes('checks'))).toBe(false);
  });

  it('returns EMPTY for a clean run, which is not the same as unreadable', () => {
    expect(parseDriftTable(CLEAN)).toEqual([]);
    expect(parseDoctorSummary(CLEAN).total).toBeGreaterThan(0);
  });

  it('is frozen, so a caller cannot mutate the finding', () => {
    expect(Object.isFrozen(rows)).toBe(true);
  });
});

describe('doctorVerdict: a missing native peer BLOCKS', () => {
  const clean = parseDoctorSummary(CLEAN);
  const drifted = parseDoctorSummary(DRIFTED);
  const missing = parseDoctorSummary(MISSING_PEER);

  it('passes when every app is clean', () => {
    expect(doctorVerdict([clean, clean])).toBe(DOCTOR_EXIT.ok);
  });

  // THE LOAD-BEARING DISTINCTION. Expo documents a missing native peer as
  // "your app may crash outside of Expo Go" -- a runtime defect, not hygiene.
  it('FAILS when any app is missing a native peer', () => {
    expect(doctorVerdict([clean, missing])).toBe(DOCTOR_EXIT.missingPeer);
  });

  // VERSION DRIFT DOES NOT BLOCK, deliberately. The fix rewrites versions the
  // Frozen Stack tests pin, and a gate born red on 15 patch drifts is one
  // everybody learns to bypass -- the adoption failure typecheck:scripts and
  // knip both document.
  it('PASSES on version drift alone, which is reported not blocking', () => {
    expect(doctorVerdict([drifted])).toBe(DOCTOR_EXIT.ok);
    expect(drifted.outdated).toBeGreaterThan(0);
  });
});

describe('doctorVerdict: a broken instrument is never a pass', () => {
  const clean = parseDoctorSummary(CLEAN);
  const unreadable = parseDoctorSummary('');

  it('is UNREADABLE when a run could not be parsed', () => {
    expect(doctorVerdict([unreadable])).toBe(DOCTOR_EXIT.unreadable);
  });

  // A loop that ran zero times -- the same shape as a worktree list with no
  // records, or an artifact audit over an empty tree.
  it('is UNREADABLE for an EMPTY list, never ok', () => {
    expect(doctorVerdict([])).toBe(DOCTOR_EXIT.unreadable);
  });

  // ORDERING: a run that could not be read cannot honestly name a peer either.
  it('UNREADABLE dominates a missing peer', () => {
    expect(doctorVerdict([unreadable, parseDoctorSummary(MISSING_PEER)])).toBe(
      DOCTOR_EXIT.unreadable,
    );
  });

  it('keeps every exit code distinct so a caller can branch', () => {
    const codes = Object.values(DOCTOR_EXIT);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('one unreadable app poisons an otherwise clean run', () => {
    expect(doctorVerdict([clean, unreadable])).toBe(DOCTOR_EXIT.unreadable);
  });
});

describe('describeDoctor names the app and the remedy', () => {
  it('reports a clean app with its ratio as evidence', () => {
    expect(describeDoctor('apps/owner-app', parseDoctorSummary(CLEAN))).toContain('20/20');
  });

  // The remedy matters: pnpm add would declare it without Expo's version
  // resolution, so the message names expo install specifically.
  it('names expo install, not pnpm add, for a missing native peer', () => {
    const msg = describeDoctor('apps/driver-app', parseDoctorSummary(MISSING_PEER));
    expect(msg).toContain('expo-constants');
    expect(msg).toContain('expo install');
  });

  it('marks drift as reported-not-blocking so nobody reads it as a failure', () => {
    const msg = describeDoctor('apps/driver-app', parseDoctorSummary(DRIFTED));
    expect(msg).toContain('15');
    expect(msg).toContain('not blocking');
  });

  it('says UNREADABLE rather than implying the app is clean', () => {
    const bad: DoctorSummary = { passed: 0, total: 0, missingPeers: [], outdated: 0 };
    expect(describeDoctor('apps/driver-app', bad)).toContain('UNREADABLE');
  });
});
