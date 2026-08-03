// apps/dispatcher-app/test/speech-recognition-timeout.test.ts
// RED (T17 D1c) -- bound the one device-controlled promise in the STT seam.
//
// getSupportedLocales() is answered by the on-device speech engine. Nothing
// guarantees it settles. If the engine wedges, the capability check never
// returns, the voice screen never leaves its loading state, and the
// dispatcher stands in front of a truck with no way forward. This repo has
// paid for the unbounded-wait class once already: scripts/sync-worktrees.ts
// records that execFileSync has no default timeout and a hung child blocked
// the event loop for 4h17m, after which every subprocess there got a bounded
// timeout with SIGTERM.
//
// The timer is INJECTED rather than raced against a real setTimeout. A real
// timer would need fake timers here, and a leaked handle keeps the node
// process alive after the suite passes. Injection makes both cases trivially
// deterministic: a delay that resolves immediately proves the timeout path,
// one that never resolves proves the happy path is not racing itself.
//
// Cancellation is NOT available: expo-speech-recognition 3.1.3 types
// getSupportedLocales as taking only androidRecognitionServicePackage, with
// no AbortSignal, so the losing promise is abandoned rather than cancelled.
// Bounding the WAIT is what is achievable, and it is what the caller needs.
//
// Degradation is deliberate: a timeout yields an EMPTY locale list, which D1a
// reads as UNKNOWN, so voice dispatch still proceeds on a device whose
// recognizer reports available. Throwing would turn a slow engine into a dead
// feature. No discriminated union is returned because assessVoiceCapability
// treats every UNKNOWN cause identically -- Android 12, a
// non-com.google.android.as service, package_not_found and a hang all mean
// the same thing to the verdict.
//
// KNOWN GAP, tracked for D1d: this degradation is SILENT. A wedged engine
// across a fleet is indistinguishable from a device that legitimately
// enumerates nothing, which is the documented silent-failure pattern -- an
// empty result treated as valid state, invisible to every monitoring surface.
// dispatcher-app has no observability wiring yet: it depends on
// @fleet/sync-protocol alone, while @fleet/observability and driver-app's
// sentry-bootstrap already exist on develop. Wiring them is its own slice.
import { describe, expect, it, vi } from 'vitest';
import {
  gatherSpeechFacts,
  LOCALE_QUERY_TIMEOUT_MS,
} from '../src/voice/speech-recognition-port.js';
import type { SpeechNativeModule } from '../src/voice/speech-recognition-port.js';
const GOOGLE = 'com.google.android.googlequicksearchbox';
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);
const immediately = (): Promise<void> => Promise.resolve();
function fakeNative(over: Partial<SpeechNativeModule> = {}): SpeechNativeModule {
  return {
    isRecognitionAvailable: () => true,
    getSpeechRecognitionServices: () => [GOOGLE],
    getSupportedLocales: () =>
      Promise.resolve({ locales: ['vi-VN'], installedLocales: [] }),
    ...over,
  };
}
describe('getSupportedLocales timeout', () => {
  it('bounds the wait at the device-facing precedent of 10s', () => {
    expect(LOCALE_QUERY_TIMEOUT_MS).toBe(10_000);
  });
  it('degrades a HUNG locale query to an empty list', async () => {
    const facts = await gatherSpeechFacts(
      fakeNative({ getSupportedLocales: never }),
      'android',
      { delay: immediately },
    );
    expect(facts.sttLocales).toEqual([]);
  });
  it('keeps the recognizer verdict when the locale query times out', async () => {
    const facts = await gatherSpeechFacts(
      fakeNative({ getSupportedLocales: never }),
      'android',
      { delay: immediately },
    );
    expect(facts.recognitionAvailable).toBe(true);
    expect(facts.recognitionServices).toEqual([GOOGLE]);
  });
  it('does not time out a query that settles first', async () => {
    const facts = await gatherSpeechFacts(fakeNative(), 'android', { delay: never });
    expect(facts.sttLocales).toEqual(['vi-VN']);
  });
  it('waits the bounded interval, not an arbitrary one', async () => {
    const delay = vi.fn(() => Promise.resolve());
    await gatherSpeechFacts(fakeNative({ getSupportedLocales: never }), 'android', {
      delay,
    });
    expect(delay).toHaveBeenCalledWith(LOCALE_QUERY_TIMEOUT_MS);
  });
  it('forwards the service package under the options shape', async () => {
    const spy = vi.fn(() =>
      Promise.resolve({ locales: ['vi-VN'], installedLocales: [] }),
    );
    await gatherSpeechFacts(fakeNative({ getSupportedLocales: spy }), 'android', {
      androidRecognitionServicePackage: GOOGLE,
    });
    expect(spy).toHaveBeenCalledWith({ androidRecognitionServicePackage: GOOGLE });
  });
});
