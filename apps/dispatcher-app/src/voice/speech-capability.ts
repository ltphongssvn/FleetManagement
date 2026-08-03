// apps/dispatcher-app/src/voice/speech-capability.ts
// Pure vi-VN voice-capability assessment (T17 V9, corrected in D1a). Adapters
// gather the native facts; this function decides, so the 2026 Android risk is
// encoded once and unit-tested with no device. A missing vi TTS voice degrades
// to system-default speech (ttsVoiceId null); it never blocks dispatching.
//
// D1a correction, read from the expo-speech-recognition 3.1.3 type definitions
// and maintainer docs rather than general web guidance: getSupportedLocales()
// returns an EMPTY locales array on Android 12 and below (API 31), is
// routinely empty on Android 13+ unless the service package is
// com.google.android.as, and can reject outright with package_not_found.
// Recognition still works in every one of those cases. Treating an empty list
// as proof of no Vietnamese support was a FALSE NEGATIVE that told a
// dispatcher on a working phone the device has no Vietnamese, blocking voice
// dispatch. Empty now means UNKNOWN, isRecognitionAvailable() is the
// authoritative signal, and a NON-empty list lacking any vi tag is still a
// genuine negative.
//
// The result is a DISCRIMINATED UNION carrying a machine-readable reasonCode
// beside the Vietnamese message, mirroring NotificationSetupResult in
// driver-app. Callers branch on the code; only the screen renders the string.
// tsc then makes reasonVi impossible to omit when sttAvailable is false and
// impossible to supply when it is true -- fail-closed at compile time, with no
// runtime cost and no unreachable defensive branch (this package gates at
// 90/90/90/90 perFile, so an uncoverable branch fails the pre-push gate).
//
// Facts arrive from our own coverage-excluded adapter, not from untrusted
// input, so there is deliberately NO schema parse here: the two-axis rule
// validates at trust boundaries only and forbids re-validating trusted
// internal data. Tolerating a malformed native payload is the adapter's job,
// at the seam, once.
export interface VoiceCapabilityFacts {
  platform: 'android' | 'ios';
  recognitionServices: readonly string[];
  /** ExpoSpeechRecognitionModule.isRecognitionAvailable(). AUTHORITATIVE:
   *  when false, start() fails with service-not-allowed or
   *  language-not-supported whatever the locale list claims. */
  recognitionAvailable: boolean;
  /** getSupportedLocales().locales. EMPTY means UNKNOWN, not unsupported. */
  sttLocales: readonly string[];
  ttsVoices: readonly { identifier: string; language: string }[];
}
/** Machine-readable denial reasons. NO_SERVICE and NO_RECOGNIZER are
 *  device-fixable; NO_VI_LOCALE means the engine enumerated locales and
 *  Vietnamese was absent. */
export type VoiceUnavailableCode = 'NO_SERVICE' | 'NO_RECOGNIZER' | 'NO_VI_LOCALE';
export type VoiceCapability =
  | {
      sttAvailable: true;
      ttsVoiceId: string | null;
      reasonCode: null;
      reasonVi: null;
    }
  | {
      sttAvailable: false;
      ttsVoiceId: string | null;
      reasonCode: VoiceUnavailableCode;
      reasonVi: string;
    };
const MESSAGE_VI: Readonly<Record<VoiceUnavailableCode, string>> = {
  NO_SERVICE: 'Thiết bị chưa có dịch vụ nhận dạng giọng nói. Vui lòng cài Google app.',
  NO_RECOGNIZER: 'Thiết bị không dùng được nhận dạng giọng nói. Vui lòng kiểm tra cài đặt.',
  NO_VI_LOCALE:
    'Thiết bị không hỗ trợ nhận dạng tiếng Việt. Vui lòng kiểm tra cài đặt ngôn ngữ.',
};
function isVi(tag: string): boolean {
  return tag.toLowerCase() === 'vi' || tag.toLowerCase().startsWith('vi-');
}
function deny(
  ttsVoiceId: string | null,
  reasonCode: VoiceUnavailableCode,
): VoiceCapability {
  return { sttAvailable: false, ttsVoiceId, reasonCode, reasonVi: MESSAGE_VI[reasonCode] };
}
export function assessVoiceCapability(facts: VoiceCapabilityFacts): VoiceCapability {
  const viVoice = facts.ttsVoices.find((v) => isVi(v.language)) ?? null;
  const ttsVoiceId = viVoice === null ? null : viVoice.identifier;
  if (facts.platform === 'android' && facts.recognitionServices.length === 0) {
    return deny(ttsVoiceId, 'NO_SERVICE');
  }
  if (!facts.recognitionAvailable) {
    return deny(ttsVoiceId, 'NO_RECOGNIZER');
  }
  if (facts.sttLocales.length > 0 && !facts.sttLocales.some((l) => isVi(l))) {
    return deny(ttsVoiceId, 'NO_VI_LOCALE');
  }
  return { sttAvailable: true, ttsVoiceId, reasonCode: null, reasonVi: null };
}
