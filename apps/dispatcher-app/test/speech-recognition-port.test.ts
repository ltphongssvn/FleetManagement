// apps/dispatcher-app/test/speech-recognition-port.test.ts
// The STT fact-gatherer, tested by EXECUTION not by reading its source. The
// native module is injected, so every branch runs in the node lane and nothing
// here needs a coverage exclusion.
//
// Only speech-recognition-native.ts stays excluded: it hands the real
// ExpoSpeechRecognitionModule to these functions. That module transitively
// loads expo-modules-core, which cannot resolve off-device, so that one import
// is the whole untestable surface.
//
// The invariants a source-text guard could never prove:
//  - getSupportedLocales() REJECTS on package_not_found and on errors while
//    retrieving locales. The rejection must become an EMPTY array, which D1a
//    defines as UNKNOWN. A catch that rethrows, logs, or returns a partial
//    list would satisfy a grep for 'catch' and still break the contract.
//  - installedLocales must be IGNORED. It is empty unless the service package
//    is com.google.android.as, so reading it would deny Vietnamese on most
//    devices. Proven by feeding a payload where the two arrays disagree.
//  - Platform.OS is a WIDE union: RN 0.85 targets android, ios, macos,
//    windows, web, tvOS, visionOS and more, and react-native-windows reports
//    'windows'. A ternary on !== 'ios' collapses all of them onto 'android',
//    so assessVoiceCapability's android-only NO_SERVICE gate would fire
//    against a browser. The mapping fails closed and names the platform.
import { describe, expect, it, vi } from 'vitest';
import {
  gatherSpeechFacts,
  toSupportedPlatform,
} from '../src/voice/speech-recognition-port.js';
import type { SpeechNativeModule } from '../src/voice/speech-recognition-port.js';
const GOOGLE = 'com.google.android.googlequicksearchbox';
function fakeNative(over: Partial<SpeechNativeModule> = {}): SpeechNativeModule {
  return {
    isRecognitionAvailable: () => true,
    getSpeechRecognitionServices: () => [GOOGLE],
    getSupportedLocales: () =>
      Promise.resolve({ locales: ['vi-VN', 'en-US'], installedLocales: [] }),
    ...over,
  };
}
describe('gatherSpeechFacts', () => {
  it('forwards the authoritative availability signal when true', async () => {
    const facts = await gatherSpeechFacts(fakeNative(), 'android');
    expect(facts.recognitionAvailable).toBe(true);
  });
  it('forwards the authoritative availability signal when false', async () => {
    const facts = await gatherSpeechFacts(
      fakeNative({ isRecognitionAvailable: () => false }),
      'android',
    );
    expect(facts.recognitionAvailable).toBe(false);
  });
  it('carries the platform and the recognition services through', async () => {
    const facts = await gatherSpeechFacts(fakeNative(), 'android');
    expect(facts.platform).toBe('android');
    expect(facts.recognitionServices).toEqual([GOOGLE]);
  });
  it('reads locales and IGNORES installedLocales', async () => {
    const facts = await gatherSpeechFacts(
      fakeNative({
        getSupportedLocales: () =>
          Promise.resolve({ locales: ['vi-VN'], installedLocales: ['en-US'] }),
      }),
      'android',
    );
    expect(facts.sttLocales).toEqual(['vi-VN']);
  });
  it('degrades a REJECTED getSupportedLocales to an empty list', async () => {
    const facts = await gatherSpeechFacts(
      fakeNative({
        getSupportedLocales: () => Promise.reject(new Error('package_not_found')),
      }),
      'android',
    );
    expect(facts.sttLocales).toEqual([]);
    expect(facts.recognitionAvailable).toBe(true);
  });
  it('passes the android service package when one is supplied', async () => {
    const spy = vi.fn(() =>
      Promise.resolve({ locales: ['vi-VN'], installedLocales: [] }),
    );
    await gatherSpeechFacts(fakeNative({ getSupportedLocales: spy }), 'android', GOOGLE);
    expect(spy).toHaveBeenCalledWith({ androidRecognitionServicePackage: GOOGLE });
  });
  it('works on ios where the services list is empty', async () => {
    const facts = await gatherSpeechFacts(
      fakeNative({ getSpeechRecognitionServices: () => [] }),
      'ios',
    );
    expect(facts.platform).toBe('ios');
    expect(facts.recognitionServices).toEqual([]);
  });
});
describe('toSupportedPlatform', () => {
  it('passes android through', () => {
    expect(toSupportedPlatform('android')).toBe('android');
  });
  it('passes ios through', () => {
    expect(toSupportedPlatform('ios')).toBe('ios');
  });
  it('throws on web rather than silently claiming android', () => {
    expect(() => toSupportedPlatform('web')).toThrow(/web/);
  });
  it('names the offending platform for windows and macos', () => {
    expect(() => toSupportedPlatform('windows')).toThrow(/windows/);
    expect(() => toSupportedPlatform('macos')).toThrow(/macos/);
  });
});
