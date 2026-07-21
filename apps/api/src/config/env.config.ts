// apps/api/src/config/env.config.ts
import { z } from 'zod';
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  // Layer-1 least-privilege split: when set, this elevated DDL-capable connection
  // string is used for boot-time migrations + seeding, while DATABASE_URL is the
  // restricted runtime role (no DDL, no DELETE). Optional: unset -> migrations fall
  // back to DATABASE_URL, so single-credential environments are unaffected.
  MIGRATION_DATABASE_URL: z.url().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30_000),
  REDIS_URL: z.url().default('redis://localhost:6379'),
  OIDC_ISSUER: z.url(),
  OIDC_AUDIENCE: z.string().min(1),
  OIDC_JWKS_URI: z.url(),
  JWT_PRIVATE_KEY_PEM: z.string().optional(),
  JWT_PUBLIC_KEY_PEM: z.string().optional(),
  JWT_ISSUER: z.string().min(1).default('fleet-pilot-api'),
  JWT_AUDIENCE: z.string().min(1).default('fleet-driver'),
  AWS_REGION: z.string().min(1).default('us-west-2'),
  S3_ARTIFACTS_BUCKET: z.string().min(1).default('fleet-pilot-artifacts'),
  S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  // Optional S3 endpoint override for local S3 (LocalStack/MinIO) in Docker
  // Compose. Unset in production -> AWS default endpoint + IAM credential chain.
  S3_ENDPOINT_URL: z.url().optional(),
  // Optional browser-reachable S3 origin. Presigned URLs are signed against
  // S3_ENDPOINT_URL (an internal Docker hostname the browser cannot resolve);
  // when set, the presigned URL origin is rewritten to this. Unset in prod.
  S3_PUBLIC_URL: z.url().optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  OTEL_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.url().optional(),
  OTEL_SERVICE_NAME: z.string().default('fleet-api'),
  OTEL_SAMPLE_RATIO: z.coerce.number().min(0).max(1).default(1.0),
  FLEET_PILOT_SCOPE: z.guid().default('00000000-0000-0000-0000-000000000000'),
  // Step-up (RFC 9470) requirement knobs. The fleet API is its own trust domain,
  // so the acr strength ladder and phishing-resistant amr set are configured here
  // rather than imported from Keycloak. CSV envs -> trimmed string arrays.
  STEP_UP_ACR_LADDER: z
    .string()
    .default('aal1,aal2,aal3')
    .transform((v) => v.split(',').map((s) => s.trim()).filter((s) => s.length > 0)),
  STEP_UP_DISPATCH_REQUIRED_ACR: z.string().min(1).default('aal2'),
  STEP_UP_DISPATCH_REQUIRE_PHISHING_RESISTANT: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  STEP_UP_PHISHING_RESISTANT_AMR: z
    .string()
    .default('hwk')
    .transform((v) => v.split(',').map((s) => s.trim()).filter((s) => s.length > 0)),
  // Break-glass login monitor (see context/keycloak-break-glass-runbook.md).
  // A poller reads master-realm login events and pages via Sentry on any
  // fleet-breakglass-* sign-in. CLIENT_SECRET is optional on purpose: unset ->
  // the monitor stays dormant (fail-safe), mirroring the AWS_*/FLEET_API_* gating.
  KEYCLOAK_BASE_URL: z.url().default('https://keycloak-production-7959.up.railway.app'),
  KEYCLOAK_MONITOR_CLIENT_ID: z.string().min(1).default('fleet-breakglass-monitor'),
  KEYCLOAK_MONITOR_CLIENT_SECRET: z.string().min(1).optional(),
  BREAKGLASS_USERNAME_PREFIX: z.string().min(1).default('fleet-breakglass'),
  BREAKGLASS_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  // Intake-lag regression guard (Jun-24 incident class): pages via Sentry
  // fatal when the OLDEST verifying manifest exceeds this age -- any break in
  // the intake loop (auth, queue, worker, relay) becomes loud within one
  // threshold window instead of silently stranding uploads for weeks.
  INTAKE_LAG_ALERT_MINUTES: z.coerce.number().int().positive().default(30),
  // Intake self-healing reconciler (2026 level-based recovery loop). Every
  // tick it re-emits the compensating intake job for verifying manifests
  // older than AFTER_MINUTES (set below the lag ALERT threshold so auto-heal
  // races the page), gated by exponential backoff off lastIntakeReconcileAt,
  // bounded by MAX_ATTEMPTS and BATCH_SIZE (the per-tick retry budget). At
  // max attempts a manifest is quarantined in place (state untouched) and a
  // distinct Sentry fatal fires. ENABLED gates the scheduler tick; unset ->
  // ON (self-healing is the safe default for production).
  INTAKE_RECONCILE_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  INTAKE_RECONCILE_AFTER_MINUTES: z.coerce.number().int().positive().default(15),
  INTAKE_RECONCILE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  INTAKE_RECONCILE_BATCH_SIZE: z.coerce.number().int().positive().default(25),
  // Completion-reconciler proactive monitor (T16 stranded-delivery guard, PR
  // #297 class). Pages via Sentry fatal when the OLDEST delivered-but-non-
  // terminal road_run (all stop photos committed, gate parity) has been
  // started longer than ALERT_MINUTES -- so a future recurrence of the
  // XTT.07-019/020 strand (order stuck in Dang chay after a late intake
  // commit) becomes loud within one threshold window instead of stranding
  // silently. ENABLED gates the scheduler tick; unset -> ON (loud-by-default
  // is the safe production posture, mirroring INTAKE_RECONCILE_ENABLED).
  COMPLETION_MONITOR_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  COMPLETION_STRANDED_ALERT_MINUTES: z.coerce.number().int().positive().default(30),
  // Completion self-healing reconciler (2026 level-based recovery loop,
  // sibling of the intake reconciler). Every tick it finds non-terminal
  // road_runs whose linked orders are ALL photo-committed (the same
  // runIsDelivered predicate the live gate + edge-trigger use) and drives
  // them started->completed through the SAME guarded flip + appendTriWrite.
  // Closes the structural gap where a manifest reaches committed WITHOUT
  // firing the finalizeIntake edge-trigger (manual redrive, pre-deploy
  // commit, edge-eval rollback): the run stranded in Dang chay with photos
  // uploaded and nothing scheduled healed it. Idempotent guarded flip -> no
  // MAX_ATTEMPTS/quarantine (unlike intake). ENABLED gates the tick; unset
  // -> ON (self-healing is the safe production default). AFTER_MINUTES set
  // low: a delivered run should complete within minutes, not stay running.
  COMPLETION_RECONCILE_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  COMPLETION_RECONCILE_AFTER_MINUTES: z.coerce.number().int().positive().default(5),
  COMPLETION_RECONCILE_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  // Inbound webhook HMAC secrets (Factor III: declared at the validated
  // boundary, not read raw in the request path). Per-provider distinct
  // secrets -- never a shared WEBHOOK_SECRET (2026 practice). Optional +
  // fail-safe dormant, mirroring KEYCLOAK_MONITOR_CLIENT_SECRET: an
  // environment that does not wire the integration boots, while the
  // request-time verifier stays fail-closed (rejects unsigned/missigned).
  EAS_WEBHOOK_SECRET: z.string().min(1).optional(),
  ERP_WEBHOOK_SECRET: z.string().min(1).optional(),
  // Browser origins allowed by CORS. CSV env -> trimmed string array (same
  // idiom as STEP_UP_ACR_LADDER). Default = local ops-web + driver-app dev
  // origins; production supplies the real origins via this var.
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:8081,http://localhost:3001')
    .transform((v) => v.split(',').map((s) => s.trim()).filter((s) => s.length > 0)),
  // Guards the seed endpoint (POST /transport-orders). Default ON; a deploy
  // sets this false to disable the seed path. Boolean-coerced like the
  // OTEL_ENABLED / INTAKE_RECONCILE_ENABLED flags.
  FLEET_PILOT_SEED_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Device attestation (arc: feature/device-binding). Server-side deployment
  // constants for hardware attestation verification. The two CSV lists are the
  // accepted app identities (an app can ship under more than one id across
  // build profiles); ATTESTATION_APPLE_TEAM_ID feeds the iOS App Attest
  // rpIdHash check SHA256(teamId.bundleId). CSV envs -> trimmed string arrays.
  ATTESTATION_ANDROID_PACKAGE_NAMES: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((x) => x.trim()).filter((x) => x.length > 0)),
  ATTESTATION_IOS_BUNDLE_IDS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((x) => x.trim()).filter((x) => x.length > 0)),
  ATTESTATION_APPLE_TEAM_ID: z.string().min(1).default('0000000000'),
});
export type Env = z.infer<typeof EnvSchema>;
// Rebuild-CLI-scoped validator (follow-up #5). Derives from the SAME EnvSchema
// SSOT via .pick() so it can never drift from the canonical contract, but
// validates ONLY the keys the projection-rebuild standalone context needs
// (DB connection + pilot scope) — NOT OIDC/S3/JWT, which are irrelevant to a
// read-model rebuild and would otherwise force unrelated config to be present.
export const RebuildEnvSchema = EnvSchema.pick({
  NODE_ENV: true,
  DATABASE_URL: true,
  DB_POOL_MAX: true,
  DB_IDLE_TIMEOUT_MS: true,
  FLEET_PILOT_SCOPE: true,
});
export type RebuildEnv = z.infer<typeof RebuildEnvSchema>;
export function validateRebuildEnv(raw: Record<string, unknown>): RebuildEnv {
  const result = RebuildEnvSchema.safeParse(raw);
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error('Invalid rebuild environment at: ' + paths);
  }
  return result.data;
}
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error('Invalid environment at: ' + paths);
  }
  return result.data;
}
