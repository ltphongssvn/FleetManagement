// apps/dispatcher-app/test/speech-recognition-observability.test.ts
// RED (T17 D1d) -- make the D1c timeout observable.
//
// D1c bounds the device-controlled locale query so a wedged speech engine
// cannot hang the capability check. It degrades to an empty list, which D1a
// reads as UNKNOWN, so voice dispatch still proceeds. That is the right
// availability trade, but it is SILENT: across a fleet, a wedged engine is
// indistinguishable from a device that legitimately enumerates nothing. An
// empty result treated as valid state is invisible to every monitoring
// surface, and metrics stay green while the experience degrades.
//
// The reporting seam is an INJECTED callback with a no-op default, for the
// same reason the timer is injected: it stays in the pure port where it can
// be executed under test, rather than in the coverage-excluded adapter where
// nothing could prove it fires. Sentry is attached at the composition root,
// so this module needs no observability dependency.
//
// The load-bearing distinction is WHICH failure reports. A rejection is
// already a distinguishable event -- package_not_found arrives as an error a
// caller could see. A HANG is the one that looks like success, so only the
// timeout path reports. Firing on every empty result would drown the signal
// in devices that simply have nothing to enumerate.
import { describe, expect, it, vi } from 'vitest';
import { gatherSpeechFacts } from '../src/voice/speech-recognition-port.js';
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
describe('locale query timeout reporting', () => {
  it('reports when the locale query HANGS past the bound', async () => {
    const onLocaleQueryTimeout = vi.fn();
    await gatherSpeechFacts(fakeNative({ getSupportedLocales: never }), 'android', {
      delay: immediately,
      onLocaleQueryTimeout,
    });
    expect(onLocaleQueryTimeout).toHaveBeenCalledTimes(1);
  });
  it('does NOT report when the query settles in time', async () => {
    const onLocaleQueryTimeout = vi.fn();
    await gatherSpeechFacts(fakeNative(), 'android', {
      delay: never,
      onLocaleQueryTimeout,
    });
    expect(onLocaleQueryTimeout).not.toHaveBeenCalled();
  });
  it('does NOT report a REJECTION, which is already distinguishable', async () => {
    const onLocaleQueryTimeout = vi.fn();
    await gatherSpeechFacts(
      fakeNative({
        getSupportedLocales: () => Promise.reject(new Error('package_not_found')),
      }),
      'android',
      { delay: never, onLocaleQueryTimeout },
    );
    expect(onLocaleQueryTimeout).not.toHaveBeenCalled();
  });
  it('does NOT report a legitimately EMPTY locale list', async () => {
    const onLocaleQueryTimeout = vi.fn();
    await gatherSpeechFacts(
      fakeNative({
        getSupportedLocales: () =>
          Promise.resolve({ locales: [], installedLocales: [] }),
      }),
      'android',
      { delay: never, onLocaleQueryTimeout },
    );
    expect(onLocaleQueryTimeout).not.toHaveBeenCalled();
  });
  it('still degrades to an empty list while reporting', async () => {
    const onLocaleQueryTimeout = vi.fn();
    const facts = await gatherSpeechFacts(
      fakeNative({ getSupportedLocales: never }),
      'android',
      { delay: immediately, onLocaleQueryTimeout },
    );
    expect(facts.sttLocales).toEqual([]);
    expect(facts.recognitionAvailable).toBe(true);
  });
  it('works with no reporter supplied, defaulting to a no-op', async () => {
    const facts = await gatherSpeechFacts(
      fakeNative({ getSupportedLocales: never }),
      'android',
      { delay: immediately },
    );
    expect(facts.sttLocales).toEqual([]);
  });
});
