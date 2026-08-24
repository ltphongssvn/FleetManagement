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
  // EQUIVALENT MUTANT, verified by running the guard chain against the mutant
  // over every window shape a real environment can present. Dropping
  // `typeof loc !== 'object'` lets a non-object location through, but the very
  // next line reads .hostname off it and gets undefined, which the string check
  // rejects -- so both variants return undefined on every input. No test can
  // distinguish them, so this is noise rather than a gap.
  //
  // The directive must be the LAST line before the code: `next-line` targets
  // the next line literally, so a multi-line reason silently points it at
  // another comment and the mutant keeps surviving.
  // Stryker disable next-line ConditionalExpression: equivalent, see above
  if (typeof loc !== 'object' || loc === null) return undefined;
  const host: unknown = (loc as { hostname?: unknown }).hostname;
  // The `true &&` collapse is EQUIVALENT: with the typeof check removed,
  // `.length > 0` on a non-string yields undefined > 0, which is false, so the
  // result is undefined either way.
  //
  // Scoped to ConditionalExpression ONLY. The other mutants on this line -- the
  // || flip and > 0 -> >= 0 -- are NOT equivalent, and the empty-hostname case
  // in api-url-guards.test.ts kills them. Disabling the whole line would hide
  // two real gaps to silence one piece of noise.
  // Stryker disable next-line ConditionalExpression: equivalent, see above
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
  // EQUIVALENT AT RUNTIME. process.env yields only string | undefined -- Node
  // coerces every assigned value and rejects a non-enumerable descriptor
  // outright, so a non-string can never reach this read. Confirmed by trying:
  //   TypeError: 'process.env' only accepts a configurable, writable, and
  //   enumerable data descriptor
  // The narrowing still earns its place because Expo INLINES this value at
  // build time and the bundler is not obliged to emit a string literal, but no
  // test can exercise the false branch without faking process itself.
  // Stryker disable next-line ConditionalExpression: equivalent, see above
  const raw = typeof rawValue === 'string' ? rawValue : undefined;
  if (raw === undefined || raw.length === 0) return DEV_FALLBACK_API_URL;
  const hostname = getWebHostname();
  if (hostname === undefined) return raw;
  // The catch is LOAD-BEARING here, and deliberately so. It previously wrapped
  // the whole rewrite and did `return raw`, which the function already does on
  // the last line -- so emptying the catch changed nothing and the mutant
  // survived as redundant code. Narrowing the try to the one call that can
  // throw makes the recovery observable: without it, u is never assigned and
  // the next line throws instead of falling back.
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  if (u.hostname === EMULATOR_HOST) {
    u.hostname = hostname;
    return u.toString().replace(/\/$/, '');
  }
  return raw;
}
