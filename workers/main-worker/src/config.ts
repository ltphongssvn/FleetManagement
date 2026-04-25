// workers/main-worker/src/config.ts
// Runtime environment validation. Fail fast on boot if env is malformed
// rather than throwing cryptic Redis/Postgres errors mid-flight.
import { z } from 'zod';

const ConfigSchema = z.object({
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment: ${result.error.message}`);
  }
  return result.data;
}
