// apps/dispatcher-app/src/polyfills/install-fetch-polyfill.ts
// SDK 55 / RN 0.83 (New Architecture / Bridgeless) regression fix -- shared
// verbatim with the driver app because it is environment-forced, not app
// logic. Under Bridgeless, React Native default fetch delegates to the
// legacy whatwg-fetch XHR polyfill and rejects EVERY request with
// TypeError: Network request failed before it leaves the device -- so the
// copilot client and the Keycloak refresh would both fail silently. Fix:
// replace global fetch with Expo modern streaming fetch (expo/fetch),
// which works under Bridgeless. MUST be imported before any code that
// performs a network request (the first import in the root layout).
import { fetch as expoFetch } from 'expo/fetch';
(globalThis as { fetch: typeof globalThis.fetch }).fetch =
  expoFetch as unknown as typeof globalThis.fetch;
