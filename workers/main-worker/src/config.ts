// workers/main-worker/src/config.ts
// Runtime environment validation. Fail fast on boot if env is malformed
// rather than throwing cryptic Redis/Postgres errors mid-flight.
import { z } from 'zod';

const ConfigSchema = z.object({
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  FLEET_API_URL: z.string().url().optional(),
  // Compose substitutes UNSET ${WORKER_FLEET_API_TOKEN} with an EMPTY STRING
  // (spec behavior) -- empty must mean ABSENT (callbacks skip), never a boot
  // crash on token-less machines (CI, fresh clones). Same class as GEMINI key.
  FLEET_API_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  ERP_API_URL: z.string().url().optional(),
  ERP_API_KEY: z.string().min(1).optional(),
  // S3 intake enrichment: worker HEADs the uploaded object to validate the real
  // content-type + size. AWS_REGION + S3_ARTIFACTS_BUCKET mirror the API. Creds
  // come from the default chain in prod; explicit keys/endpoint support local S3.
  AWS_REGION: z.string().min(1).optional(),
  S3_ARTIFACTS_BUCKET: z.string().min(1).optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_ENDPOINT: z.string().url().optional(),
  // Phieu-can net-weight extraction (Gemini VLM adapter). Key optional: absent
  // -> extraction jobs complete with 'ports not configured' skip (pilot can run
  // without it). Model defaults to gemini-3.5-flash (GA): wrong kg on a stop is
  // business-unacceptable, accuracy tier wins; override for cost A/B.
  // Compose interpolates ${GEMINI_API_KEY:-} => EMPTY STRING when unset in
  // .env; empty must mean ABSENT (skip extraction), not a boot crash.
  GEMINI_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.5-flash'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment: ${result.error.message}`);
  }
  return result.data;
}
