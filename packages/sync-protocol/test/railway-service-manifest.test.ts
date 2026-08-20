// packages/sync-protocol/src/railway-service-manifest.test.ts
// RED-first. Inputs are REAL manifests captured from Railway project
// vominhchau/production via `railway deployment list --service <name> --json`
// on 2026-08-19, not invented fixtures. Every assertion below therefore
// documents a live production defect, and goes GREEN only when the platform
// is actually remediated.
import { describe, expect, it } from 'vitest';
import {
  CONTAINER_MEMORY_BYTES_MAX,
  CONTAINER_MEMORY_BYTES_MIN,
  FLEET_REGION,
  FLEET_RESTART_MAX_RETRIES,
  FleetServicePolicySchema,
  ObservedServiceManifestSchema,
  isPinnedImage,
} from '../src/railway-service-manifest.js';

/** worker: Dockerfile.worker, SE-Asia, deploy 2026-08-19T20:13:30Z. */
const OBSERVED_WORKER = {
  build: { builder: 'DOCKERFILE', watchPatterns: [], dockerfilePath: 'Dockerfile.worker' },
  deploy: {
    region: 'asia-southeast1-eqsg3a',
    numReplicas: 1,
    restartPolicyType: 'ON_FAILURE',
    restartPolicyMaxRetries: 10,
    sleepApplication: false,
    limitOverride: null,
    healthcheckPath: null,
    healthcheckTimeout: null,
    startCommand: null,
  },
  image: null,
} as const;

/** Keycloak: template-provisioned RAILPACK, us-west2, deploy 2026-06-19T15:05:10Z. */
const OBSERVED_KEYCLOAK = {
  build: { builder: 'RAILPACK', watchPatterns: [], dockerfilePath: null },
  deploy: {
    region: 'us-west2',
    numReplicas: 1,
    restartPolicyType: 'ON_FAILURE',
    restartPolicyMaxRetries: 10,
    sleepApplication: false,
    limitOverride: null,
    healthcheckPath: null,
    healthcheckTimeout: null,
    startCommand: '/opt/keycloak/bin/kc.sh start',
  },
  image: 'quay.io/keycloak/keycloak:latest',
} as const;

describe('reconciliation: the Observed axis accepts real platform payloads', () => {
  it('parses the worker manifest', () => {
    expect(ObservedServiceManifestSchema.safeParse(OBSERVED_WORKER).success).toBe(true);
  });

  it('parses the Keycloak manifest', () => {
    expect(ObservedServiceManifestSchema.safeParse(OBSERVED_KEYCLOAK).success).toBe(true);
  });
});

describe('policy: worker', () => {
  const result = FleetServicePolicySchema.safeParse(OBSERVED_WORKER);

  it('satisfies fleet service policy', () => {
    expect(result.success).toBe(true);
  });

  it('pins restart retries at 3, not the dashboard default of 10 (debt 7)', () => {
    expect(OBSERVED_WORKER.deploy.restartPolicyMaxRetries).toBe(FLEET_RESTART_MAX_RETRIES);
  });

  it('declares watch patterns so unrelated pushes do not rebuild it (debt 8)', () => {
    expect(OBSERVED_WORKER.build.watchPatterns.length).toBeGreaterThan(0);
  });
});

describe('policy: Keycloak', () => {
  const result = FleetServicePolicySchema.safeParse(OBSERVED_KEYCLOAK);

  it('satisfies fleet service policy', () => {
    expect(result.success).toBe(true);
  });

  it('bounds container memory so the JVM cannot size its heap off host RAM (debt 1)', () => {
    const bytes = OBSERVED_KEYCLOAK.deploy.limitOverride?.containers?.memoryBytes;
    expect(bytes).toBeGreaterThanOrEqual(CONTAINER_MEMORY_BYTES_MIN);
    expect(bytes).toBeLessThanOrEqual(CONTAINER_MEMORY_BYTES_MAX);
  });

  it('runs in the same region as the rest of the stack (debt 3)', () => {
    expect(OBSERVED_KEYCLOAK.deploy.region).toBe(FLEET_REGION);
  });

  it('pins the image to a digest so auth cannot silently upgrade (debt 4)', () => {
    expect(isPinnedImage(OBSERVED_KEYCLOAK.image)).toBe(true);
  });
});
