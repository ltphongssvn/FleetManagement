// apps/dispatcher-app/test/speech-capability.test.ts
// Spec for the pure vi-VN voice-capability assessment (T17 V9, updated D1a).
// The 2026 risk: Android STT availability depends on the device speech engine
// and must be checked at runtime; iOS reports its system recognizer as a
// service entry with vi-VN in its locale list; TTS needs a vi voice picked
// from getAvailableVoicesAsync. This function is PURE -- adapters gather the
// native facts, it decides.
//
// D1a: facts now carry recognitionAvailable (isRecognitionAvailable()), which
// is authoritative, and the result is a discriminated union carrying a
// machine-readable reasonCode beside the Vietnamese message. Assertions target
// reasonCode; one case still pins the vi text so the wording cannot silently
// drift. Fixtures that omitted recognitionAvailable produced undefined and
// short-circuited to NO_RECOGNIZER -- a required field is deliberate, so the
// adapter cannot forget to supply the authoritative signal.
import { describe, expect, it } from 'vitest';
import { assessVoiceCapability } from '../src/voice/speech-capability.js';
const VI_VOICE = { identifier: 'vi-vn-x-vif-local', language: 'vi-VN' };
const EN_VOICE = { identifier: 'en-us-x-sfg-local', language: 'en-US' };
const GOOGLE = 'com.google.android.googlequicksearchbox';
describe('@fleet/dispatcher-app assessVoiceCapability', () => {
  it('is available on android with a recognition service and a vi voice', () => {
    const cap = assessVoiceCapability({
      platform: 'android',
      recognitionServices: [GOOGLE],
      recognitionAvailable: true,
      sttLocales: ['vi-VN', 'en-US'],
      ttsVoices: [EN_VOICE, VI_VOICE],
    });
    expect(cap.sttAvailable).toBe(true);
    expect(cap.ttsVoiceId).toBe('vi-vn-x-vif-local');
    expect(cap.reasonCode).toBeNull();
    expect(cap.reasonVi).toBeNull();
  });
  it('is unavailable on android without any recognition service', () => {
    const cap = assessVoiceCapability({
      platform: 'android',
      recognitionServices: [],
      recognitionAvailable: true,
      sttLocales: ['vi-VN'],
      ttsVoices: [VI_VOICE],
    });
    expect(cap.sttAvailable).toBe(false);
    expect(cap.reasonCode).toBe('NO_SERVICE');
  });
  it('is unavailable when vi-VN is not in a NON-empty STT locale list', () => {
    const cap = assessVoiceCapability({
      platform: 'android',
      recognitionServices: [GOOGLE],
      recognitionAvailable: true,
      sttLocales: ['en-US', 'th-TH'],
      ttsVoices: [VI_VOICE],
    });
    expect(cap.sttAvailable).toBe(false);
    expect(cap.reasonCode).toBe('NO_VI_LOCALE');
    expect(cap.reasonVi).toContain('tiếng Việt');
  });
  it('falls back to system TTS when no vi voice exists but STT works', () => {
    const cap = assessVoiceCapability({
      platform: 'android',
      recognitionServices: [GOOGLE],
      recognitionAvailable: true,
      sttLocales: ['vi-VN'],
      ttsVoices: [EN_VOICE],
    });
    expect(cap.sttAvailable).toBe(true);
    expect(cap.ttsVoiceId).toBeNull();
  });
  it('matches vi voices case-insensitively and by vi prefix', () => {
    const cap = assessVoiceCapability({
      platform: 'ios',
      recognitionServices: ['com.apple.speech'],
      recognitionAvailable: true,
      sttLocales: ['VI-vn'],
      ttsVoices: [{ identifier: 'apple-vi', language: 'vi' }],
    });
    expect(cap.sttAvailable).toBe(true);
    expect(cap.ttsVoiceId).toBe('apple-vi');
  });
});
