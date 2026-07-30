// apps/dispatcher-app/app/_layout.tsx
// Root layout for the voice-dispatch app (T17 S6). Renders the router outlet
// and the providers every screen needs; the voice dialog and review screens
// mount beneath it in later slices.
//
// NOTE: the fetch polyfill is deliberately NOT imported here. It is installed
// by the custom entry point (index.js, referenced by package.json main), which
// is the root of the module graph. This file is a ROUTE module, and Expo
// Router decides when route modules evaluate -- a nested group layout can
// evaluate before it (expo/expo discussion 25122), so a side effect placed
// here would not reliably run first. Re-adding the import would also give the
// polyfill two homes and imply the entry cannot be trusted;
// test/entry-point-wiring.test.ts fails if it reappears.
import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
export default function RootLayout(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <Slot />
    </SafeAreaProvider>
  );
}
