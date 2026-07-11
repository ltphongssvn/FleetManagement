// apps/owner-app/src/polyfills/install-fetch-polyfill.ts
// SDK 55 / RN 0.83 (New Architecture / Bridgeless) regression fix.
//
// RN 0.83 makes the New Architecture (Bridgeless) mandatory. Under Bridgeless,
// React Native default fetch — which delegates to the legacy whatwg-fetch XHR
// polyfill (react-native/Libraries/Network/fetch.js does require('whatwg-fetch'))
// — rejects EVERY request immediately with TypeError: Network request failed,
// thrown from the XHR onerror handler before the request leaves the device.
// That is why the app logs nothing, the server never receives the request, and
// the SAME code works on web (browser native fetch, not whatwg-fetch). See
// github.com/pingdotgg/uploadthing/issues/1273 (Expo SDK 55 / RN 0.83).
//
// Fix: replace the global fetch with Expo modern streaming fetch (expo/fetch),
// which works under Bridgeless. expo/fetch exports only fetch (no
// Request/Response/Headers classes); the app calls fetch(url, { method,
// headers, body }) with a plain object, so overriding fetch alone is enough.
// This module MUST be imported before any code that performs a network request
// (the first import in the app entry / root layout).
import { fetch as expoFetch } from 'expo/fetch';

// expo/fetch's signature is structurally compatible with the global fetch but
// uses its own types, so cast through unknown to assign the global.
(globalThis as { fetch: typeof globalThis.fetch }).fetch =
  expoFetch as unknown as typeof globalThis.fetch;
