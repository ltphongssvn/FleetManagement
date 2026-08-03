// apps/dispatcher-app/src/voice/speech-recognition-port.ts
// STT fact-gatherer (T17 D1b). Pure: the native module is INJECTED, so every
// branch is unit-testable in the node lane with no device and no coverage
// exclusion. Only speech-recognition-native.ts is excluded -- a few lines
// handing the real ExpoSpeechRecognitionModule and Platform.OS to these
// functions. That module transitively loads expo-modules-core, which cannot
// resolve off-device, and isolating that import is the point of the split.
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
/** The only two platforms this app supports. assessVoiceCapability branches on
 *  it, so a wrong value silently changes the verdict. */
export type SupportedPlatform = 'android' | 'ios';
/** Facts consumed by assessVoiceCapability, minus ttsVoices, which the TTS
 *  adapter supplies in D2. */
export interface SpeechFacts {
  platform: SupportedPlatform;
  recognitionServices: readonly string[];
  recognitionAvailable: boolean;
  sttLocales: readonly string[];
}
// Platform.OS is a WIDE union. React Native 0.85 targets android, ios, macos,
// windows, web, tvOS, visionOS and more, and react-native-windows reports
// 'windows'. The obvious ternary -- os === 'ios' ? 'ios' : 'android' --
// collapses every one of those onto 'android', so assessVoiceCapability's
// android-only NO_SERVICE gate would fire against a browser and tell the
// dispatcher to install the Google app. That is the same silent
// misclassification D1a removed, so this fails closed instead and NAMES the
// platform it got. Platform.select is not an alternative here: with only ios
// and android keys it returns undefined on web, propagating the failure
// quietly rather than stopping it.
export function toSupportedPlatform(os: string): SupportedPlatform {
  if (os === 'android' || os === 'ios') return os;
  throw new Error(
    'Voice dispatch supports android and ios only; got platform: ' + os,
  );
}
// getSupportedLocales rejects on package_not_found and on errors while
// retrieving locales. A rejection degrades to an EMPTY list, which the policy
// reads as UNKNOWN -- never as proof Vietnamese is absent. Rethrowing would
// kill the capability check on a device that can actually hear.
//
// Written as a returning try/catch rather than a reassigned let: both paths
// produce a value, so the initialiser would be a dead store that
// no-useless-assignment rejects under --max-warnings=0.
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
  platform: SupportedPlatform,
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
