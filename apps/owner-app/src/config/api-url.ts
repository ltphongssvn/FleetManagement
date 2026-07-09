// apps/owner-app/src/config/api-url.ts
// Single source of truth for the backend base URL. Every owner screen and
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
// Type-safe read of the web page origin host. globalThis.window is typed as a
// structural shape via a type guard (no as-any cast) so type-aware lint rules
// resolve the same way in every environment (local + CI) instead of degrading
// to any when the parser's type info differs. Returns undefined on native,
// where there is no window.
function getWebHostname(): string | undefined {
  const g: typeof globalThis & { window?: unknown } = globalThis;
  const win: unknown = g.window;
  if (typeof win !== 'object' || win === null) return undefined;
  const loc: unknown = (win as { location?: unknown }).location;
  if (typeof loc !== 'object' || loc === null) return undefined;
  const host: unknown = (loc as { hostname?: unknown }).hostname;
  return typeof host === 'string' && host.length > 0 ? host : undefined;
}
export function getApiUrl(): string {
  // EXPO_PUBLIC_API_URL MUST be read as a STATIC literal expression
  // (process.env.EXPO_PUBLIC_API_URL) — Expo only inlines EXPO_PUBLIC_* vars
  // that appear literally; a dynamic process.env[name] access is NOT inlined and
  // resolves to undefined in the production bundle (which silently fell back to
  // http://localhost:3000 on device -> ConnectException). Narrow via typeof so
  // it stays type-safe whether process.env is typed as string-record or any.
  const rawValue: unknown = process.env['EXPO_PUBLIC_API_URL'];
  const raw = typeof rawValue === 'string' ? rawValue : undefined;
  if (raw === undefined || raw.length === 0) return DEV_FALLBACK_API_URL;
  const hostname = getWebHostname();
  if (hostname === undefined) return raw;
  try {
    const u = new URL(raw);
    if (u.hostname === EMULATOR_HOST) {
      u.hostname = hostname;
      return u.toString().replace(/\/$/, '');
    }
  } catch {
    return raw;
  }
  return raw;
}
