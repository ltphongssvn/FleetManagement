// apps/dispatcher-app/index.js
// Custom entry point, per the Expo Router manual-installation guide section on
// initializing and loading side-effects (docs last updated 2026-04-28). This
// file is the ROOT of the module graph -- package.json main points here -- so
// the ordering below is enforced by the module system itself, not by
// convention.
//
// Why not app/_layout.tsx: that is a ROUTE module, and Expo Router decides when
// route modules evaluate. A nested group layout can evaluate BEFORE the root
// layout -- reported in expo/expo discussion 25122, where a polyfill placed in
// app/_layout.tsx loaded after (tabs)/_layout.tsx. Making the polyfill the
// first import of the root layout is an invariant the framework never
// promised: it holds by accident of the current route tree and breaks silently
// the day someone adds a route group.
//
// The polyfill MUST be first: under RN 0.83 Bridgeless the default whatwg-fetch
// rejects every request from its XHR onerror handler before it leaves the
// device, and any module evaluated ahead of the swap captures the broken
// reference for the life of the process. expo-router/entry MUST be last: it
// pulls in the entire route tree and the React Native networking stack.
//
// Intentionally .js and side-effect-only: it has zero type surface for tsc to
// check, and TypeScript at the entry/config layer has broken module resolution
// in monorepos before (expo/expo issue 24790). The specifier is extensionless
// because Metro resolves .ts via sourceExts and this file is outside tsc; the
// NodeNext .js suffix used in driver-app would be wrong here.
//
// test/entry-point-wiring.test.ts pins every property above.
import './src/polyfills/install-fetch-polyfill';
import 'expo-router/entry';
