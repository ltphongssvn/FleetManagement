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
  JWT_PRIVATE_KEY_PEM: z.string().optional(),
  JWT_PUBLIC_KEY_PEM: z.string().optional(),
  JWT_ISSUER: z.string().min(1).default('fleet-pilot-api'),
  JWT_AUDIENCE: z.string().min(1).default('fleet-driver'),
  AWS_REGION: z.string().min(1).default('us-west-2'),
  S3_ARTIFACTS_BUCKET: z.string().min(1).default('fleet-pilot-artifacts'),
  S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  // Optional S3 endpoint override for local S3 (LocalStack/MinIO) in Docker
  // Compose. Unset in production -> AWS default endpoint + IAM credential chain.
  S3_ENDPOINT_URL: z.string().url().optional(),
  // Optional browser-reachable S3 origin. Presigned URLs are signed against
  // S3_ENDPOINT_URL (an internal Docker hostname the browser cannot resolve);
  // when set, the presigned URL origin is rewritten to this. Unset in prod.
  S3_PUBLIC_URL: z.string().url().optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  OTEL_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().default('fleet-api'),
  OTEL_SAMPLE_RATIO: z.coerce.number().min(0).max(1).default(1.0),
  FLEET_PILOT_SCOPE: z.string().uuid().default('00000000-0000-0000-0000-000000000000'),
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
