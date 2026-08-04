// apps/dispatcher-app/src/config/env.ts
// Config boundary for the dispatcher app (T17 V10b, Twelve-Factor III).
// Deploy-varying handles are read from the injected env record ONCE,
// Zod-validated, and exposed as a typed object; business code consumes
// DispatcherEnv, never process.env. Critical handles fail fast: a typed
// throw at startup surfaces a deploy error a silent fallback would hide.
// Two-axis: unknown keys pass through untouched (loose consumer input);
// the parsed OUTPUT shape is the z.infer SSOT.
//
// D1d adds the Sentry DSN, deliberately NOT critical. A deploy without the
// API URL or the OIDC handles is broken; a deploy without a DSN is merely
// unobserved, and bricking voice dispatch over a telemetry handle would trade
// a reporting gap for an outage.
//
// A MALFORMED DSN degrades to absent rather than throwing, which is where
// this departs from the common z.url().optional() env recipe. That recipe
// fails the boot on a bad value, so a typo in a telemetry handle would brick
// the app -- the same bad trade in a different disguise. The value is still
// validated when present, because a broken DSN must not reach the Sentry SDK;
// it just falls back to absent. buildSentryOptions in @fleet/observability
// then returns { options: null, skipReason }, which is the observable signal.
import { z } from 'zod';
const HttpsUrl = z
  .url()
  .refine((u) => u.startsWith('https://'), { message: 'must be https' });
const RawEnvSchema = z.looseObject({
  EXPO_PUBLIC_API_BASE_URL: z.url(),
  EXPO_PUBLIC_OIDC_ISSUER: HttpsUrl,
  EXPO_PUBLIC_OIDC_CLIENT_ID: z.string().min(1),
  EXPO_PUBLIC_SENTRY_DSN: z.url().optional().catch(undefined),
});
export interface DispatcherEnv {
  readonly apiBaseUrl: string;
  readonly oidcIssuer: string;
  readonly oidcClientId: string;
  /** Absent when unset OR when the supplied value failed validation. */
  readonly sentryDsn?: string;
}
function stripTrailingSlash(u: string): string {
  return u.endsWith('/') ? u.slice(0, -1) : u;
}
export function parseDispatcherEnv(
  raw: Record<string, string | undefined>,
): DispatcherEnv {
  const parsed = RawEnvSchema.parse(raw);
  const base = {
    apiBaseUrl: stripTrailingSlash(parsed.EXPO_PUBLIC_API_BASE_URL),
    oidcIssuer: stripTrailingSlash(parsed.EXPO_PUBLIC_OIDC_ISSUER),
    oidcClientId: parsed.EXPO_PUBLIC_OIDC_CLIENT_ID,
  };
  // The key is OMITTED, not set to undefined: exactOptionalPropertyTypes makes
  // those different types, and widening sentryDsn to string | undefined would
  // discard the distinction the setting exists to enforce. The spec asserts
  // this with Object.hasOwn precisely because the two are not interchangeable.
  return parsed.EXPO_PUBLIC_SENTRY_DSN === undefined
    ? base
    : { ...base, sentryDsn: parsed.EXPO_PUBLIC_SENTRY_DSN };
}
