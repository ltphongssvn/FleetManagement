// apps/dispatcher-app/src/voice/speech-capability.ts
// Pure vi-VN voice-capability assessment (T17 V9). Adapters gather the
// native facts (recognition services, STT locales, TTS voices); this
// function decides, so the 2026 Android risk -- STT availability depends
// on the device speech engine and must be checked at runtime -- is
// encoded once and unit-tested without natives. iOS reports its system
// recognizer as a service entry; vi-VN sits in its locale list. A missing
// vi TTS voice degrades to system-default speech (ttsVoiceId null), it
// never blocks dispatching.
export interface VoiceCapabilityFacts {
  platform: 'android' | 'ios';
  recognitionServices: readonly string[];
  sttLocales: readonly string[];
  ttsVoices: readonly { identifier: string; language: string }[];
}
export interface VoiceCapability {
  sttAvailable: boolean;
  ttsVoiceId: string | null;
  reasonVi: string | null;
}
const NO_SERVICE_VI =
  'Thiết bị chưa có dịch vụ nhận dạng giọng nói. Vui lòng cài Google app.';
const NO_VI_LOCALE_VI =
  'Thiết bị không hỗ trợ nhận dạng tiếng Việt. Vui lòng kiểm tra cài đặt ngôn ngữ.';
function isVi(tag: string): boolean {
  return tag.toLowerCase() === 'vi' || tag.toLowerCase().startsWith('vi-');
}
export function assessVoiceCapability(facts: VoiceCapabilityFacts): VoiceCapability {
  const viVoice = facts.ttsVoices.find((v) => isVi(v.language)) ?? null;
  const ttsVoiceId = viVoice === null ? null : viVoice.identifier;
  if (facts.platform === 'android' && facts.recognitionServices.length === 0) {
    return { sttAvailable: false, ttsVoiceId, reasonVi: NO_SERVICE_VI };
  }
  if (!facts.sttLocales.some((l) => isVi(l))) {
    return { sttAvailable: false, ttsVoiceId, reasonVi: NO_VI_LOCALE_VI };
  }
  return { sttAvailable: true, ttsVoiceId, reasonVi: null };
}
