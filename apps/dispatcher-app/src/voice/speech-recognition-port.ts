// apps/dispatcher-app/src/voice/speech-recognition-port.ts
// STT fact-gatherer (T17 D1b/D1c). Pure: the native module and the timer are
// INJECTED, so every branch is unit-testable in the node lane with no device
// and no coverage exclusion. Only speech-recognition-native.ts is excluded --
// a few lines handing the real ExpoSpeechRecognitionModule and Platform.OS to
// these functions. That module transitively loads expo-modules-core, which
// cannot resolve off-device, and isolating that import is the point.
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
/** Options rather than positional arguments: the timer injection made the
 *  third slot a hole callers had to fill with undefined. */
export interface GatherSpeechFactsOptions {
  androidRecognitionServicePackage?: string;
  /** Injected so tests need no fake timers, whose leaked handles keep the node
   *  process alive after a suite passes. Defaults to a real timer. */
  delay?: (ms: number) => Promise<void>;
}
// Matches COMMAND_DELIVERY_TIMEOUT_MS in apps/api/src/commands/command-policy.
// ts, the repo's existing device-facing bound. getSupportedLocales is called
// once at screen mount, not on the interaction path, so this never sits in a
// UI-responsiveness budget; the screen owns its own loading state.
export const LOCALE_QUERY_TIMEOUT_MS = 10_000;
const realDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
// Platform.OS is a WIDE union. React Native 0.85 targets android, ios, macos,
// windows, web, tvOS, visionOS and more, and react-native-windows reports
// 'windows'. The obvious ternary -- os === 'ios' ? 'ios' : 'android' --
// collapses every one of those onto 'android', so assessVoiceCapability's
// android-only NO_SERVICE gate would fire against a browser and tell the
// dispatcher to install the Google app. This fails closed and NAMES the
// platform it got. Platform.select is not an alternative: with only ios and
// android keys it returns undefined on web, propagating the failure quietly.
export function toSupportedPlatform(os: string): SupportedPlatform {
  if (os === 'android' || os === 'ios') return os;
  throw new Error(
    'Voice dispatch supports android and ios only; got platform: ' + os,
  );
}
// Three ways the locale list can fail to arrive, all meaning UNKNOWN:
//  - REJECTION: package_not_found, or an error retrieving locales.
//  - HANG: the on-device engine never answers. Unbounded, that wedges the
//    capability check forever -- the class scripts/sync-worktrees.ts records
//    as a 4h17m block before every subprocess there got a bounded timeout.
//  - An empty list, which D1a already reads as UNKNOWN.
// All three yield [], so voice dispatch still proceeds when the recognizer
// reports available. Throwing would turn a slow engine into a dead feature.
//
// The losing promise is ABANDONED, not cancelled: 3.1.3 exposes no
// AbortSignal on getSupportedLocales, so bounding the wait is what is
// achievable. It is also what the caller needs.
//
// KNOWN GAP (D1d): a timeout is indistinguishable from a device that
// legitimately enumerates nothing. Across a fleet that hides a wedged engine.
// dispatcher-app has no observability wiring yet; @fleet/observability and
// driver-app's sentry-bootstrap already exist on develop.
async function localesOrEmpty(
  native: SpeechNativeModule,
  options: GatherSpeechFactsOptions,
): Promise<string[]> {
  const delay = options.delay ?? realDelay;
  const query = native
    .getSupportedLocales(
      options.androidRecognitionServicePackage === undefined
        ? {}
        : {
            androidRecognitionServicePackage:
              options.androidRecognitionServicePackage,
          },
    )
    // locales, NEVER installedLocales: the latter is empty unless the service
    // package is com.google.android.as, so reading it would deny Vietnamese on
    // most devices.
    .then((supported) => supported.locales)
    .catch((): string[] => []);
  const timeout = delay(LOCALE_QUERY_TIMEOUT_MS).then((): string[] => []);
  return Promise.race([query, timeout]);
}
export async function gatherSpeechFacts(
  native: SpeechNativeModule,
  platform: SupportedPlatform,
  options: GatherSpeechFactsOptions = {},
): Promise<SpeechFacts> {
  const sttLocales = await localesOrEmpty(native, options);
  return {
    platform,
    recognitionServices: native.getSpeechRecognitionServices(),
    recognitionAvailable: native.isRecognitionAvailable(),
    sttLocales,
  };
}
