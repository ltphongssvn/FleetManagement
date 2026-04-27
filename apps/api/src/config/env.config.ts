// apps/api/src/config/env.config.ts
import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30_000),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
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
