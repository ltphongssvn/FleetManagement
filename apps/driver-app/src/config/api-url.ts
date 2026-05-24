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
export function getApiUrl(): string {
  const raw = process.env['EXPO_PUBLIC_API_URL'] as string | undefined;
  if (raw === undefined || raw.length === 0) return DEV_FALLBACK_API_URL;
  return raw;
}
