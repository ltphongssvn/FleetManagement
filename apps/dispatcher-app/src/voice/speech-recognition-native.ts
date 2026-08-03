// apps/dispatcher-app/src/voice/speech-recognition-native.ts
// The last millimetre of the STT seam (T17 D1b). This file exists ONLY to
// hand the real ExpoSpeechRecognitionModule and Platform.OS to the pure
// functions in speech-recognition-port.ts. It holds no logic: rejection
// handling, the locales-vs-installedLocales choice, the optional service
// package and the platform narrowing all live in the port and are fully
// unit-tested against an injected fake.
//
// Coverage-EXCLUDED, and the only excluded module in this seam.
// expo-speech-recognition transitively loads expo-modules-core, which cannot
// resolve in the node test lane, so importing it here would break every suite
// in the lane. That single import is the entire untestable surface, which is
// why this file is kept this small: there is no room for a bug a unit test
// could have caught. Guarded by test/speech-recognition-native-wiring.test.ts.
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Platform } from 'react-native';
import {
  gatherSpeechFacts,
  toSupportedPlatform,
  type SpeechFacts,
} from './speech-recognition-port.js';
/** Gather live STT facts from the device. androidRecognitionServicePackage is
 *  forwarded verbatim; app.json pins com.google.android.googlequicksearchbox,
 *  and passing it makes getSupportedLocales query that engine rather than the
 *  default. An invalid value makes the native call reject with
 *  package_not_found, which the port degrades to an empty locale list. */
export async function gatherNativeSpeechFacts(
  androidRecognitionServicePackage?: string,
): Promise<SpeechFacts> {
  return gatherSpeechFacts(
    ExpoSpeechRecognitionModule,
    toSupportedPlatform(Platform.OS),
    androidRecognitionServicePackage,
  );
}
