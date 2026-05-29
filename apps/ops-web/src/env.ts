// apps/ops-web/src/env.ts
// Runtime env validation per Frozen Stack PDF principles.
// Fail fast at boot if env is malformed.
import { z } from 'zod';

const EnvSchema = z.object({
  NEXT_PUBLIC_APP_VERSION: z.string().regex(/^\d+\.\d+\.\d+/).default('0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof EnvSchema>;

/** Accepts any record for testability; production callers pass process.env. */
export function loadEnv(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(env);
  if (!result.success) throw new Error(`Invalid env: ${result.error.message}`);
  return result.data;
}
