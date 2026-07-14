// apps/dispatcher-app/test/speech-capability.test.ts
// RED-first spec for the pure vi-VN voice-capability assessment (T17 V9).
// The web-confirmed 2026 risk: Android STT availability depends on the
// device speech engine (must be checked at runtime), iOS ships
// SFSpeechRecognizer with vi-VN in its locale list, and TTS needs a
// vi voice picked from getAvailableVoicesAsync. This function is PURE:
// adapters gather the native facts, it decides. Written before
// src/voice/speech-capability.ts exists -> fails at import resolution.
import { describe, expect, it } from 'vitest';
import { assessVoiceCapability } from '../src/voice/speech-capability.js';
const VI_VOICE = { identifier: 'vi-vn-x-vif-local', language: 'vi-VN' };
const EN_VOICE = { identifier: 'en-us-x-sfg-local', language: 'en-US' };
describe('@fleet/dispatcher-app assessVoiceCapability', () => {
  it('is available on android with a recognition service and a vi voice', () => {
    const cap = assessVoiceCapability({
      platform: 'android',
      recognitionServices: ['com.google.android.googlequicksearchbox'],
      sttLocales: ['vi-VN', 'en-US'],
      ttsVoices: [EN_VOICE, VI_VOICE],
    });
    expect(cap.sttAvailable).toBe(true);
    expect(cap.ttsVoiceId).toBe('vi-vn-x-vif-local');
    expect(cap.reasonVi).toBeNull();
  });
  it('is unavailable on android without any recognition service', () => {
    const cap = assessVoiceCapability({
      platform: 'android',
      recognitionServices: [],
      sttLocales: ['vi-VN'],
      ttsVoices: [VI_VOICE],
    });
    expect(cap.sttAvailable).toBe(false);
    expect(cap.reasonVi).toContain('dịch vụ nhận dạng giọng nói');
  });
  it('is unavailable when vi-VN is not in the STT locales', () => {
    const cap = assessVoiceCapability({
      platform: 'ios',
      recognitionServices: ['system'],
      sttLocales: ['en-US', 'ja-JP'],
      ttsVoices: [VI_VOICE],
    });
    expect(cap.sttAvailable).toBe(false);
    expect(cap.reasonVi).toContain('tiếng Việt');
  });
  it('falls back to system TTS when no vi voice exists but STT works', () => {
    const cap = assessVoiceCapability({
      platform: 'ios',
      recognitionServices: ['system'],
      sttLocales: ['vi-VN'],
      ttsVoices: [EN_VOICE],
    });
    expect(cap.sttAvailable).toBe(true);
    expect(cap.ttsVoiceId).toBeNull();
  });
  it('matches vi voices case-insensitively and by vi prefix', () => {
    const cap = assessVoiceCapability({
      platform: 'android',
      recognitionServices: ['svc'],
      sttLocales: ['vi-VN'],
      ttsVoices: [{ identifier: 'x-vi', language: 'VI' }],
    });
    expect(cap.ttsVoiceId).toBe('x-vi');
  });
});
