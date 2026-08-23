// workers/main-worker/src/config.ts
// Runtime environment validation. Fail fast on boot if env is malformed
// rather than throwing cryptic Redis/Postgres errors mid-flight.
import { z } from 'zod';
const ConfigSchema = z.object({
  REDIS_URL: z.url().default('redis://localhost:6379'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  FLEET_API_URL: z.url().optional(),
  // OAuth2 client-credentials (RFC 6749 s4.4) replacing the static
  // FLEET_API_TOKEN whose silent JWT expiry stalled 65 manifests in
  // verifying from Jun-24. WORKER_OIDC_TOKEN_URL is the FULL Keycloak token
  // endpoint (one URL, no realm-path assembly). All three optional: absent
  // -> callbacks skip (pilot-safe boot, mirrors FLEET_API_URL gating).
  // Compose substitutes UNSET vars with an EMPTY STRING (spec behavior) --
  // empty must mean ABSENT, never a boot crash on token-less machines.
  WORKER_OIDC_TOKEN_URL: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
  WORKER_OIDC_CLIENT_ID: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  WORKER_OIDC_CLIENT_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  ERP_API_URL: z.url().optional(),
  ERP_API_KEY: z.string().min(1).optional(),
  // S3 intake enrichment: worker HEADs the uploaded object to validate the real
  // content-type + size. AWS_REGION + S3_ARTIFACTS_BUCKET mirror the API. Creds
  // come from the default chain in prod; explicit keys/endpoint support local S3.
  AWS_REGION: z.string().min(1).optional(),
  S3_ARTIFACTS_BUCKET: z.string().min(1).optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_ENDPOINT: z.url().optional(),
  // Phieu-can net-weight extraction (Gemini VLM adapter). Key optional: absent
  // -> extraction jobs complete with 'ports not configured' skip (pilot can run
  // without it). Model defaults to gemini-3.5-flash (GA): wrong kg on a stop is
  // business-unacceptable, accuracy tier wins; override for cost A/B.
  // Compose interpolates the key as EMPTY STRING when unset in .env; empty must
  // mean ABSENT (skip extraction), not a boot crash.
  GEMINI_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.5-flash'),
});
export type Config = z.infer<typeof ConfigSchema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new Error('Invalid environment: ' + result.error.message);
  }
  return result.data;
}
