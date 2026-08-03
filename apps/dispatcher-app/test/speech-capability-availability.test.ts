// apps/dispatcher-app/test/speech-capability-availability.test.ts
// RED (T17 D1a). Read from expo-speech-recognition 3.1.3 type definitions
// and the maintainer docs, NOT from general web guidance -- which is how the
// original V9 spec missed this.
//
// getSupportedLocales() returns an EMPTY locales array on Android 12 and
// below (API 31), and on Android 13+ it is routinely empty unless the service
// package is com.google.android.as. It can also REJECT with package_not_found.
// Recognition still works in all of those cases. The V9 policy treats a
// missing vi tag as proof of no Vietnamese support, so any of them yields a
// FALSE NEGATIVE that tells a dispatcher on a working phone that the device
// does not support Vietnamese -- and blocks voice dispatch for the pilot.
//
// Correct semantics: an EMPTY locale list means UNKNOWN, not unsupported.
// isRecognitionAvailable() is the authoritative signal and takes precedence;
// a NON-empty list that lacks vi is still a genuine negative.
import { describe, expect, it } from 'vitest';
import { assessVoiceCapability } from '../src/voice/speech-capability.js';
const VI_VOICE = { identifier: 'vi-vn-x-vif-local', language: 'vi-VN' };
const GOOGLE = 'com.google.android.googlequicksearchbox';
describe('assessVoiceCapability - availability semantics', () => {
  it('stays available when the locale list is empty but the recognizer is'
    + ' available (Android 12 enumeration gap)', () => {
    const cap = assessVoiceCapability({
      platform: 'android', recognitionServices: [GOOGLE],
      recognitionAvailable: true, sttLocales: [], ttsVoices: [VI_VOICE],
    });
    expect(cap.sttAvailable).toBe(true);
    expect(cap.reasonVi).toBeNull();
  });
  it('is unavailable when the recognizer itself reports unavailable', () => {
    const cap = assessVoiceCapability({
      platform: 'android', recognitionServices: [GOOGLE],
      recognitionAvailable: false, sttLocales: ['vi-VN'], ttsVoices: [VI_VOICE],
    });
    expect(cap.sttAvailable).toBe(false);
    expect(cap.reasonVi).not.toBeNull();
  });
  it('still rejects a NON-empty locale list with no vi tag', () => {
    const cap = assessVoiceCapability({
      platform: 'android', recognitionServices: [GOOGLE],
      recognitionAvailable: true, sttLocales: ['en-US'], ttsVoices: [VI_VOICE],
    });
    expect(cap.sttAvailable).toBe(false);
  });
  it('lets recognizer-unavailable win over an empty locale list', () => {
    const cap = assessVoiceCapability({
      platform: 'ios', recognitionServices: [],
      recognitionAvailable: false, sttLocales: [], ttsVoices: [VI_VOICE],
    });
    expect(cap.sttAvailable).toBe(false);
  });
  it('resolves the vi tts voice even when stt is unavailable', () => {
    const cap = assessVoiceCapability({
      platform: 'android', recognitionServices: [],
      recognitionAvailable: false, sttLocales: [], ttsVoices: [VI_VOICE],
    });
    expect(cap.ttsVoiceId).toBe('vi-vn-x-vif-local');
  });
});
