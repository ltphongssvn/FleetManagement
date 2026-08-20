// packages/sync-protocol/test/railway-service-manifest.test.ts
// Asserts the Railway production estate against fleet policy.
//
// Input is test/fixtures/railway-production-manifests.json, captured from
// `railway deployment list --service <name> --json`. The fixture is parsed
// through the Observed axis first: if the platform payload stops matching the
// schema, that surfaces as a parse failure rather than as a misleading policy
// verdict. Refresh the fixture after any platform change.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONTAINER_MEMORY_BYTES_MAX,
  CONTAINER_MEMORY_BYTES_MIN,
  FLEET_REGION,
  FLEET_RESTART_MAX_RETRIES,
  ObservedServiceManifestSchema,
  isPinnedImage,
} from '../src/railway-service-manifest.js';

const FIXTURE = join(
  import.meta.dirname,
  'fixtures/railway-production-manifests.json',
);

const captured = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  capturedAt: string;
  services: Record<string, unknown>;
};

const observed = (name: string) => {
  const parsed = ObservedServiceManifestSchema.safeParse(captured.services[name]);
  if (!parsed.success) {
    throw new Error(`${name} manifest no longer matches ObservedServiceManifestSchema`);
  }
  return parsed.data;
};

describe('reconciliation', () => {
  it('records when the estate was captured', () => {
    expect(captured.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('parses every captured manifest through the Observed axis', () => {
    for (const name of Object.keys(captured.services)) {
      expect(() => observed(name)).not.toThrow();
    }
  });
});

describe.each(['Keycloak', 'worker'])('policy: %s', (name) => {
  const manifest = observed(name);

  it('runs in the fleet region (debt 3)', () => {
    expect(manifest.deploy.region).toBe(FLEET_REGION);
  });

  it('restarts on failure with pinned retries (debt 7)', () => {
    expect(manifest.deploy.restartPolicyType).toBe('ON_FAILURE');
    expect(manifest.deploy.restartPolicyMaxRetries).toBe(FLEET_RESTART_MAX_RETRIES);
  });

  it('declares serverless explicitly so a dashboard toggle is drift', () => {
    expect(typeof manifest.deploy.sleepApplication).toBe('boolean');
  });

  it('runs exactly one replica', () => {
    expect(manifest.deploy.numReplicas).toBe(1);
  });
});

describe('policy: Keycloak specifics', () => {
  const manifest = observed('Keycloak');

  it('bounds container memory so the JVM cannot size its heap off host RAM (debt 1)', () => {
    const bytes = manifest.deploy.limitOverride?.containers?.memoryBytes;
    expect(bytes).toBeGreaterThanOrEqual(CONTAINER_MEMORY_BYTES_MIN);
    expect(bytes).toBeLessThanOrEqual(CONTAINER_MEMORY_BYTES_MAX);
  });

  it('pins the image to a digest so auth cannot silently upgrade (debt 4)', () => {
    expect(isPinnedImage(manifest.image)).toBe(true);
  });
});
