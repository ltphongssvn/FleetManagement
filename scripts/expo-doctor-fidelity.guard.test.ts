// scripts/expo-doctor-fidelity.guard.test.ts
// A FIDELITY TEST: run the REAL pinned binary and prove the parser still
// understands it. Every other test of this parser uses a FROZEN FIXTURE.
//
// THE DEFECT THIS CLOSES, and it is a property of the tests rather than the
// code. parseDoctorSummary reads PROSE from a tool this repo does not own --
// "19/20 checks passed", "15 packages out of date", "Missing peer dependency:"
// -- and every unit test feeds it a string captured on 2026-08-19. If Expo
// rewords any of those sentences in a later release, the fixtures still match,
// the suite stays GREEN, and the live parse silently yields total:0. The
// verdict correctly routes that to UNREADABLE and the gate blocks -- so the
// visible symptom is a merge gate refusing every push with "output could not
// be read", while every test in the repo insists the parser is fine.
//
// 2026 agent-tooling practice names this exactly: a fidelity test runs the
// real CLI and the parser against the same input and fails when they diverge,
// "because the fixture is stale" is precisely the class unit tests cannot see.
// The deeper rule -- "there is no English on stdout to parse heuristically,
// ever" -- is not available to us here: expo-doctor has no machine-readable
// output mode, so the prose IS the interface. When a contract cannot be
// structured, it must at least be OBSERVED.
//
// WHY THIS IS NOT MERELY A SECOND COPY OF THE GATE. //#expo:doctor asks "are
// the Expo apps healthy". This asks "does the parser still understand the
// tool" -- a different question with a different failure mode, and the one
// that turns an upstream wording change from a confusing gate refusal into a
// named test failure pointing at the regex that needs updating.
//
// PINNED, SO THE ANSWER IS STABLE. expo-doctor is an exact devDependency
// (EXPO_DOCTOR_VERSION), so this test is deterministic for a given lockfile:
// it can only start failing when someone bumps the pin, which is exactly when
// a human should be looking at the output format.
//
// NETWORK-TOLERANT BY DESIGN. expo-doctor reaches the Expo API for its version
// checks, and a test suite that fails on an offline laptop is a test everyone
// learns to skip. An unreachable network is SKIPPED with a reason; only a
// binary that RAN and produced unparseable output is a failure. That is the
// same distinction gate-coverage.ts draws between a host problem and a red
// suite.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  EXPO_APPS,
  EXPO_DOCTOR_VERSION,
  doctorArgs,
  parseDoctorSummary,
} from './expo-doctor.js';

const ROOT = resolve(import.meta.dirname, '..');
const NL = String.fromCharCode(10);
const APP = EXPO_APPS[0] ?? 'apps/driver-app';

/** Run the real, locked binary once and keep the bytes. */
function liveOutput(): { ran: boolean; text: string } {
  const run = spawnSync('pnpm', ['exec', ...doctorArgs()], {
    cwd: resolve(ROOT, APP),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });
  if (run.error !== undefined) return { ran: false, text: '' };
  return { ran: true, text: run.stdout + NL + run.stderr };
}

const live = liveOutput();
// A run that never started, or that produced nothing at all, is a HOST or
// NETWORK condition -- not evidence about the parser. Skipping names the
// reason; failing here would make an offline laptop look like a code defect.
const canObserve = live.ran && live.text.trim().length > 0;

describe.skipIf(!canObserve)('the parser still understands the real binary', () => {
  const parsed = parseDoctorSummary(live.text);

  // THE ASSERTION. total:0 is the parser's own unreadable signal, so seeing it
  // against REAL output means the wording moved and the regexes no longer
  // match -- the exact drift no frozen fixture can detect.
  it('reads a check ratio from live output, not zero', () => {
    expect({ total: parsed.total, readable: parsed.total > 0 })
      .toEqual({ total: parsed.total, readable: true });
    expect(parsed.total).toBeGreaterThan(0);
  });

  // A ratio where passed exceeds total means the capture groups swapped or the
  // sentence changed shape -- parseable, and wrong, which is worse than
  // unparseable because it would be believed.
  it('yields a COHERENT ratio, so the groups have not swapped', () => {
    expect(parsed.passed).toBeLessThanOrEqual(parsed.total);
    expect(parsed.passed).toBeGreaterThanOrEqual(0);
  });

  // expo-doctor runs a known-sized battery; a single-digit total would mean we
  // matched some other "N/M" in the output, such as a progress line.
  it('matches the CHECK ratio rather than some other N/M in the text', () => {
    expect(parsed.total).toBeGreaterThanOrEqual(10);
  });

  // Positive control on the source text itself: if this phrase disappears, the
  // parse above is matching something unintended.
  it('the live output still contains the sentence the parser anchors on', () => {
    expect(live.text).toContain('checks passed');
  });

  // Counts must be finite numbers, never NaN from a failed Number() coercion.
  it('produces finite counts, never NaN', () => {
    expect(Number.isFinite(parsed.passed)).toBe(true);
    expect(Number.isFinite(parsed.total)).toBe(true);
    expect(Number.isFinite(parsed.outdated)).toBe(true);
  });

  // Ties the observation to the exact reviewed binary, so a future failure can
  // be attributed to a specific version rather than to "expo-doctor".
  it('observed the PINNED version, so this result is attributable', () => {
    const v = spawnSync('pnpm', ['exec', ...doctorArgs(), '--version'], {
      cwd: resolve(ROOT, APP),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    expect(v.stdout.trim()).toBe(EXPO_DOCTOR_VERSION);
  });
});
