// apps/driver-app/src/config/api-url.ts
// Single source of truth for the backend base URL. Every driver screen and
// HTTP client resolves the API URL through getApiUrl so the env-read and the
// localhost dev fallback are defined exactly once.
//
// EXPO_PUBLIC_API_URL is inlined by Expo at build time. In a real build it is
// always set; the localhost fallback is purely for local dev where the var
// may be absent. An empty string is treated as unset (a blank env value is a
// misconfiguration, not a valid URL) so dev still gets a working default.
const DEV_FALLBACK_API_URL = 'http://localhost:3000';
// 10.0.2.2 is the Android-emulator alias for the host loopback. It is inlined
// at build time, but a host browser (RN-Web Playwright E2E) cannot reach it, so
// on web we rewrite that one host to the page origin's hostname. Native (no
// window) keeps the inlined emulator alias untouched.
const EMULATOR_HOST = '10.0.2.2';
export function getApiUrl(): string {
  const raw = process.env['EXPO_PUBLIC_API_URL'];
  if (raw === undefined || raw.length === 0) return DEV_FALLBACK_API_URL;
  const win = (globalThis as { window?: { location?: { hostname?: string } } }).window;
  const hostname = win?.location?.hostname;
  if (hostname !== undefined && hostname.length > 0) {
    try {
      const u = new URL(raw);
      if (u.hostname === EMULATOR_HOST) {
        u.hostname = hostname;
        return u.toString().replace(/\/$/, '');
      }
    } catch {
      return raw;
    }
  }
  return raw;
}
