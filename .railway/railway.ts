// .railway/railway.ts
// Infrastructure as Code for Railway project vominhchau / production.
// Config defined in code overrides the dashboard, so this file is the SSOT
// for the service estate and `railway config plan` reports drift against it.
//
// Scope: api and ops-web remain managed by apps/*/railway.json. A service
// cannot be managed by both systems at once, so they migrate separately.
import { defineRailway, image, service, volume } from 'railway/iac';

/** One region for every runtime service. Cross-region auth rides the public
 *  internet and cannot use Railway's private network. */
const REGION = 'asia-southeast1-eqsg3a';

/** 1 GiB. Keycloak sets no fixed -Xmx: it sizes the heap at
 *  MaxRAMPercentage=70 of CONTAINER memory. With no container limit the JVM
 *  reads the host's RAM and the heap grows unbounded -- observed 1.0 -> 4.3 GB
 *  at 0.0 vCPU, then OOM. Bounding the container is the fix; JAVA_OPTS_APPEND
 *  can override defaults but cannot undo them. 70% of 1 GiB ~= 717 MB heap,
 *  above the 512 MB this image historically used. */
const MEMORY_BYTES = 1_073_741_824;

/** Digest observed on the running deployment 2026-06-19T15:05:10Z. A mutable
 *  tag on the identity provider lets api and worker lose auth to an
 *  unreviewed upgrade. */
const KEYCLOAK_DIGEST =
  'sha256:5fdbf2dbb5897cc34e82de49d13e23db011f9925089dbc555fc095f2c8bc1dac';

export default defineRailway((_ctx, project) => {
  const keycloakVolume = volume('postgres-volume-HKmU', { region: REGION });

  const keycloak = service('Keycloak', {
    // No autoUpdates: Railway supports it only for Docker Hub and GHCR, and it
    // is inert against a digest anyway -- moving a tag cannot change a pinned
    // artifact. quay.io offers no tag immutability, so the digest IS the
    // control. Day-2: automated digest-update proposals, never a floating tag.
    source: image(`quay.io/keycloak/keycloak@${KEYCLOAK_DIGEST}`),
    build: { builder: 'RAILPACK', watchPatterns: [] },
    startCommand: '/opt/keycloak/bin/kc.sh start',
    // KC_HEALTH_ENABLED was set but Railway never probed it: a hung-but-alive
    // Keycloak took auth down for api and worker with no restart triggered.
    healthcheckPath: '/health/ready',
    healthcheckTimeout: 120,
    regions: { [REGION]: 1 },
    deploy: {
      region: REGION,
      numReplicas: 1,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 3,
      sleepApplication: false,
      limitOverride: { containers: { memoryBytes: MEMORY_BYTES } },
    },
    variables: {
      // Metrics accumulate in a Micrometer registry with no scraper attached.
      KC_METRICS_ENABLED: 'false',
      KC_HEALTH_ENABLED: 'true',
      // Public IdP: without strict hostname the Host header shapes issuer URLs.
      KC_HOSTNAME_STRICT: 'true',
    },
    volumeMounts: { [keycloakVolume.name]: { mountPath: '/var/lib/postgresql/data' } },
  });

  const worker = service('worker', {
    build: {
      builder: 'DOCKERFILE',
      dockerfilePath: 'Dockerfile.worker',
      // Empty patterns rebuilt worker on every push across 50+ worktrees.
      watchPatterns: [
        'workers/main-worker/**',
        'packages/domain/**',
        'packages/sync-protocol/**',
        'packages/observability/**',
        'Dockerfile.worker',
        'pnpm-lock.yaml',
      ],
    },
    regions: { [REGION]: 1 },
    deploy: {
      region: REGION,
      numReplicas: 1,
      restartPolicyType: 'ON_FAILURE',
      // Dashboard default was 10; api and ops-web pin 3 in railway.json.
      restartPolicyMaxRetries: 3,
      // BullMQ polls Redis continuously so this can never sleep. Declared
      // explicitly so a dashboard toggle surfaces as drift.
      sleepApplication: false,
      limitOverride: { containers: { memoryBytes: MEMORY_BYTES } },
    },
  });

  return project('vominhchau', {
    environments: ['production'],
    resources: [keycloakVolume, keycloak, worker],
  });
});
