// workers/main-worker/src/config.ts
// Runtime environment validation. Fail fast on boot if env is malformed
// rather than throwing cryptic Redis/Postgres errors mid-flight.
import { z } from 'zod';

const ConfigSchema = z.object({
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  FLEET_API_URL: z.string().url().optional(),
  FLEET_API_TOKEN: z.string().min(1).optional(),
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
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment: ${result.error.message}`);
  }
  return result.data;
}
