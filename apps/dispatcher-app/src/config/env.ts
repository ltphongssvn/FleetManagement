// apps/dispatcher-app/src/config/env.ts
// Config boundary for the dispatcher app (T17 V10b, Twelve-Factor III).
// Deploy-varying handles are read from the injected env record ONCE,
// Zod-validated, and exposed as a typed object; business code consumes
// DispatcherEnv, never process.env. Critical handles fail fast: a typed
// throw at startup surfaces a deploy error a silent fallback would hide.
// Two-axis: unknown keys pass through untouched (loose consumer input);
// the parsed OUTPUT shape is the z.infer SSOT.
import { z } from 'zod';
const HttpsUrl = z
  .url()
  .refine((u) => u.startsWith('https://'), { message: 'must be https' });
const RawEnvSchema = z.looseObject({
  EXPO_PUBLIC_API_BASE_URL: z.url(),
  EXPO_PUBLIC_OIDC_ISSUER: HttpsUrl,
  EXPO_PUBLIC_OIDC_CLIENT_ID: z.string().min(1),
});
export interface DispatcherEnv {
  readonly apiBaseUrl: string;
  readonly oidcIssuer: string;
  readonly oidcClientId: string;
}
function stripTrailingSlash(u: string): string {
  return u.endsWith('/') ? u.slice(0, -1) : u;
}
export function parseDispatcherEnv(
  raw: Record<string, string | undefined>,
): DispatcherEnv {
  const parsed = RawEnvSchema.parse(raw);
  return {
    apiBaseUrl: stripTrailingSlash(parsed.EXPO_PUBLIC_API_BASE_URL),
    oidcIssuer: stripTrailingSlash(parsed.EXPO_PUBLIC_OIDC_ISSUER),
    oidcClientId: parsed.EXPO_PUBLIC_OIDC_CLIENT_ID,
  };
}
