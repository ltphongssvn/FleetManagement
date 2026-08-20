// packages/sync-protocol/src/railway-service-manifest.ts
// Zod SSOT for Railway service manifests (railway SDK 3.10.0 ServiceConfig).
//
// Two axes, deliberately separate:
//   Observed* -- permissive; mirrors the SDK's nullability so any real payload
//                from `railway deployment list --json` parses. Reconciliation.
//   Policy*   -- strict; encodes the target state. A Policy failure on an
//                Observed input is therefore a real defect, never a spec bug.
//
// Why a schema at all: the SDK types `deploy.region` as a bare `string` and
// makes `deploy.limitOverride` fully optional, so TypeScript cannot catch an
// unbounded container or a service stranded in the wrong region.
//
// Root cause this encodes: the Keycloak container sets no fixed -Xmx. It sizes
// the heap at MaxRAMPercentage=70 of *container* memory. With no container
// limit the JVM reads the host's memory and the heap grows unbounded --
// observed 1.0 GB -> 4.3 GB at 0.0 vCPU, then OOM. The fix is the container
// limit; JAVA_OPTS_APPEND can override defaults but cannot undo them.
import { z } from 'zod';

/** Every runtime service in project vominhchau must sit in this region. */
export const FLEET_REGION = 'asia-southeast1-eqsg3a' as const;

/** Pinned in code for api/ops-web; the unpinned dashboard default is 10. */
export const FLEET_RESTART_MAX_RETRIES = 3 as const;

/** Floor: below ~750 MB a 70% heap drops under the historic 512 MB default. */
export const CONTAINER_MEMORY_BYTES_MIN = 786_432_000 as const;

/** Ceiling for this 5-truck pilot: 1 GiB -> ~717 MB heap at MaxRAMPercentage=70. */
export const CONTAINER_MEMORY_BYTES_MAX = 1_073_741_824 as const;

export const RESTART_POLICY_TYPES = ['ON_FAILURE', 'ALWAYS', 'NEVER'] as const;
export const BUILDERS = ['NIXPACKS', 'DOCKERFILE', 'RAILPACK', 'HEROKU', 'PAKETO'] as const;

// ---------------------------------------------------------------------------
// Axis 1: Observed -- the untrusted platform boundary. Nothing is required.
// ---------------------------------------------------------------------------

export const ObservedContainerLimitsSchema = z.object({
  cpu: z.number().nullish(),
  memoryBytes: z.number().nullish(),
  diskBytes: z.number().nullish(),
});

export const ObservedBuildSchema = z.object({
  builder: z.enum(BUILDERS).nullish(),
  watchPatterns: z.array(z.string()).nullish(),
  dockerfilePath: z.string().nullish(),
});

export const ObservedDeploySchema = z.object({
  region: z.string().nullish(),
  numReplicas: z.number().nullish(),
  restartPolicyType: z.enum(RESTART_POLICY_TYPES).nullish(),
  restartPolicyMaxRetries: z.number().nullish(),
  sleepApplication: z.boolean().nullish(),
  limitOverride: z.object({ containers: ObservedContainerLimitsSchema.nullish() }).nullish(),
  healthcheckPath: z.string().nullish(),
  healthcheckTimeout: z.number().nullish(),
  startCommand: z.string().nullish(),
});

export const ObservedServiceManifestSchema = z.object({
  build: ObservedBuildSchema,
  deploy: ObservedDeploySchema,
  image: z.string().nullish(),
});

// ---------------------------------------------------------------------------
// Axis 2: Policy -- the target state. Strict by construction.
// ---------------------------------------------------------------------------

export const PolicyContainerLimitsSchema = z.object({
  memoryBytes: z
    .number()
    .int()
    .min(CONTAINER_MEMORY_BYTES_MIN)
    .max(CONTAINER_MEMORY_BYTES_MAX),
});

export const PolicyBuildSchema = z.object({
  builder: z.enum(BUILDERS),
  watchPatterns: z.array(z.string()).min(1),
});

export const PolicyDeploySchema = z.object({
  region: z.literal(FLEET_REGION),
  numReplicas: z.number().int().positive(),
  restartPolicyType: z.literal('ON_FAILURE'),
  restartPolicyMaxRetries: z.literal(FLEET_RESTART_MAX_RETRIES),
  sleepApplication: z.boolean(),
  limitOverride: z.object({ containers: PolicyContainerLimitsSchema }),
});

export const FleetServicePolicySchema = z.object({
  build: PolicyBuildSchema,
  deploy: PolicyDeploySchema,
});

export type ObservedServiceManifest = z.infer<typeof ObservedServiceManifestSchema>;
export type FleetServicePolicy = z.infer<typeof FleetServicePolicySchema>;

/**
 * A mutable tag on a production image is a silent-upgrade hazard: the running
 * digest changes with no commit, no review and no rollback point.
 */
export const isPinnedImage = (image: string | null | undefined): boolean =>
  typeof image === 'string' && image.includes('@sha256:');
