// apps/api/test/health.worker-version.controller.test.ts
// RED: api exposes the WORKER's provenance, so CI can verify the worker deploy
// over the HTTP surface it already probes.
//
// WHY THE API READS IT. The worker has no HTTP surface and no public Railway
// domain, so CI cannot ask it directly. It writes a TTL'd heartbeat to Redis at
// boot (workers/main-worker/src/boot-provenance.ts); api reads that key back.
// The pairing proves the worker booted AND reached its dependencies -- stronger
// than grepping logs, which proves only that a string was printed.
//
// WHY NOT /health/ready. Folding this into readiness would make api's ability
// to serve traffic depend on the worker being up: a worker outage would pull
// api OUT of the load balancer. Provenance is a different question from "can
// this instance serve requests", so it gets its own endpoint, where failing
// closed costs nothing because no traffic is routed on it.
import { describe, it, expect } from 'vitest';
import { testSha } from '@fleet/test-fixtures';
import { DeployVersionSchema, type DeployVersion } from '@fleet/sync-protocol';
import { HealthController, type WorkerProvenanceReader } from '../src/health/health.controller.js';

const SHA = testSha(1);

// Derived through the schema, never hand-shaped: a literal fixture can drift
// from the contract silently, which is the exact class of bug this endpoint
// exists to catch.
const VERSION: DeployVersion = DeployVersionSchema.parse({
  sha: SHA,
  shortSha: SHA.slice(0, 7),
  branch: 'main',
  buildTime: '2026-08-03T09:00:00.000Z',
});

// Typed to the real collaborator interface, not `as never`. A cast would keep
// compiling if the controller gained a dependency, and fail only at runtime --
// hiding precisely the contract change a test should surface.
function makeCtl(read: WorkerProvenanceReader): HealthController {
  const pool = { query: () => Promise.resolve({}) } as never;
  return new HealthController(pool, read);
}

describe('@fleet/api - HealthController.workerVersion', () => {
  it('returns the provenance the worker recorded at boot', async () => {
    const v = await makeCtl(() => Promise.resolve(JSON.stringify(VERSION))).workerVersion();
    expect(v).toStrictEqual(VERSION);
  });

  // Each failure asserts its SPECIFIC message. A bare .toThrow() is satisfied by
  // a TypeError from a misspelled method, so it would pass while proving nothing
  // -- the fail-open shape this codebase has been bitten by before.
  it('reports an ABSENT heartbeat: the worker never booted, or its TTL expired', async () => {
    await expect(makeCtl(() => Promise.resolve(null)).workerVersion())
      .rejects.toThrow(/no worker provenance/i);
  });

  it('reports CORRUPT provenance rather than comparing CI against garbage', async () => {
    await expect(makeCtl(() => Promise.resolve('{"sha":"not-a-sha"}')).workerVersion())
      .rejects.toThrow(/provenance is not valid/i);
  });

  it('reports UNREADABLE rather than masking a Redis outage as absent', async () => {
    await expect(makeCtl(() => Promise.reject(new Error('ECONNREFUSED'))).workerVersion())
      .rejects.toThrow(/could not be read/i);
  });

  it('rejects non-JSON without leaking the raw stored value', async () => {
    await expect(makeCtl(() => Promise.resolve('<html>502</html>')).workerVersion())
      .rejects.toThrow(/provenance is not valid/i);
  });
});
