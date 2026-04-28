// apps/api/src/config/env.config.ts
import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30_000),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  OIDC_ISSUER: z.string().url(),
  OIDC_AUDIENCE: z.string().min(1),
  OIDC_JWKS_URI: z.string().url(),
  AWS_REGION: z.string().min(1).default('us-west-2'),
  S3_ARTIFACTS_BUCKET: z.string().min(1).default('fleet-pilot-artifacts'),
  S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  OTEL_ENABLED: z.coerce.boolean().default(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().default('fleet-api'),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment at: ${paths}`);
  }
  return result.data;
}
