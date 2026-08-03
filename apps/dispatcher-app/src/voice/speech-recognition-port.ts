// apps/dispatcher-app/src/voice/speech-recognition-port.ts
// STT fact-gatherer (T17 D1b). Pure: the native module is INJECTED, so every
// branch is unit-testable in the node lane with no device and no coverage
// exclusion. Only speech-recognition-native.ts is excluded -- a single line
// handing the real ExpoSpeechRecognitionModule to this function. That module
// transitively loads expo-modules-core, which cannot resolve off-device, and
// isolating that one import is the entire point of this split.
//
// This gathers; it never decides. assessVoiceCapability owns the verdict.
/** The subset of ExpoSpeechRecognitionModule 3.1.3 this app consumes. A
 *  structural subset, so the real module satisfies it with no cast. The
 *  sync/async split is the library's own: only getSupportedLocales returns a
 *  Promise. */
export interface SpeechNativeModule {
  isRecognitionAvailable(): boolean;
  getSpeechRecognitionServices(): string[];
  getSupportedLocales(options: {
    androidRecognitionServicePackage?: string;
  }): Promise<{ locales: string[]; installedLocales: string[] }>;
}
/** Facts consumed by assessVoiceCapability, minus ttsVoices, which the TTS
 *  adapter supplies in D2. */
export interface SpeechFacts {
  platform: 'android' | 'ios';
  recognitionServices: readonly string[];
  recognitionAvailable: boolean;
  sttLocales: readonly string[];
}
// getSupportedLocales rejects on package_not_found and on errors while
// retrieving locales. A rejection degrades to an EMPTY list, which the policy
// reads as UNKNOWN -- never as proof Vietnamese is absent. Rethrowing would
// kill the capability check on a device that can actually hear.
//
// Written as a returning try/catch rather than a reassigned let: both paths
// produce a value, so the initialiser would be a dead store (no-useless-
// assignment) and the binding need not be mutable at all.
async function localesOrEmpty(
  native: SpeechNativeModule,
  androidRecognitionServicePackage?: string,
): Promise<string[]> {
  try {
    const supported = await native.getSupportedLocales(
      androidRecognitionServicePackage === undefined
        ? {}
        : { androidRecognitionServicePackage },
    );
    // locales, NEVER installedLocales: the latter is empty unless the service
    // package is com.google.android.as, so reading it would deny Vietnamese on
    // most devices.
    return supported.locales;
  } catch {
    return [];
  }
}
export async function gatherSpeechFacts(
  native: SpeechNativeModule,
  platform: 'android' | 'ios',
  androidRecognitionServicePackage?: string,
): Promise<SpeechFacts> {
  const sttLocales = await localesOrEmpty(native, androidRecognitionServicePackage);
  return {
    platform,
    recognitionServices: native.getSpeechRecognitionServices(),
    recognitionAvailable: native.isRecognitionAvailable(),
    sttLocales,
  };
}
