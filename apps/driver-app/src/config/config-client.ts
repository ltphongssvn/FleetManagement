// apps/driver-app/src/config/config-client.ts
// Fetches /config/client from API. Validates wire shape at boundary.
import { z } from 'zod';

const RetryEntrySchema = z.object({
  maxAttempts: z.number().int().positive(),
  baseSeconds: z.number().positive(),
  jitterRatio: z.number().min(0).max(1),
});

const CapabilityFlagsSchema = z.object({
  enableChunkChecksums: z.boolean(),
  enableDynamicBackpressure: z.boolean(),
  enableRuntimeStrictValidator: z.boolean(),
  enableAtomicConfigLockCoordination: z.boolean(),
  enableArtifactContendedShadowCircuitBreaker: z.boolean(),
});

export const ClientConfigSchema = z.object({
  configVersion: z.number().int().nonnegative(),
  polygonVersion: z.number().int().nonnegative(),
  hysteresisVersion: z.number().int().nonnegative(),
  configFlagVersion: z.number().int().nonnegative(),
  shadowSessionLimit: z.number().int().nonnegative(),
  shadowIdleTimeoutMs: z.number().int().nonnegative(),
  arrivalHintDedupWindowSeconds: z.number().int().nonnegative(),
  arrivalHintExpiryHours: z.number().int().nonnegative(),
  geofenceToleranceMeters: z.number().nonnegative(),
  geofenceHysteresisSeconds: z.number().int().nonnegative(),
  tieBreakerBufferMeters: z.number().nonnegative(),
  bootstrapAbandonedAfterMinutes: z.number().int().nonnegative(),
  softGraceSeconds: z.number().int().nonnegative(),
  hardGraceSeconds: z.number().int().nonnegative(),
  advisoryLockMaxWaitMs: z.number().int().nonnegative(),
  revocationReasonSchemaVersion: z.number().int().nonnegative(),
  retryPolicy: z.record(z.string(), RetryEntrySchema),
  capabilityFlags: CapabilityFlagsSchema,
});

export type ClientConfig = z.infer<typeof ClientConfigSchema>;

export interface FetchConfigOptions {
  readonly apiUrl: string;
  readonly bearerToken: () => string | Promise<string>;
  readonly fetchFn?: typeof globalThis.fetch;
}

export async function fetchClientConfig(opts: FetchConfigOptions): Promise<ClientConfig> {
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const token = await opts.bearerToken();
  const res = await fetchFn(`${opts.apiUrl}/config/client`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`/config/client HTTP ${String(res.status)} ${res.statusText}`);
  }
  const raw = (await res.json()) as unknown;
  const parsed = ClientConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`/config/client invalid shape: ${parsed.error.message}`);
  }
  return parsed.data;
}
