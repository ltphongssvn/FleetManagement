// apps/ops-web/src/env.ts
// Runtime env validation per Frozen Stack PDF principles.
// Fail fast at boot if env is malformed.
import { z } from 'zod';

const EnvSchema = z.object({
  NEXT_PUBLIC_APP_VERSION: z.string().regex(/^\d+\.\d+\.\d+/).default('0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // OIDC Authorization Code + PKCE login (replaces ROPC). Optional so envs
  // that do not run the dispatcher web login (e.g. CI unit runs) need not set
  // them; the login action fails fast with server_error if unset at runtime.
  OIDC_AUTHORIZATION_ENDPOINT: z.url().optional(),
  OIDC_TOKEN_ENDPOINT: z.url().optional(),
  OIDC_CLIENT_ID: z.string().min(1).optional(),
  OIDC_REDIRECT_URI: z.url().optional(),
  // Optional acr to request at login so the dispatcher role is forced through
  // MFA up front, matching the API's RFC 9470 step-up enforcement.
  OIDC_DISPATCH_ACR_VALUES: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/** Accepts any record for testability; production callers pass process.env. */
export function loadEnv(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(env);
  if (!result.success) throw new Error(`Invalid env: ${result.error.message}`);
  return result.data;
}
