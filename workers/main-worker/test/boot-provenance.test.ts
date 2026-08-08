// workers/main-worker/test/boot-provenance.test.ts
// RED: the worker must report WHICH COMMIT is live, like api and ops-web.
//
// THE GAP. railway-deploy stamps GIT_SHA on the worker (deploy-stamp --stamp
// --service worker), but its deploy step is `sleep 30; railway logs ... || true`
// -- a gate that cannot fail. The worker could crash-loop, or serve a release
// behind, and the deploy would still go green.
//
// WHY REDIS, NOT AN HTTP ENDPOINT. The worker has no HTTP surface and no public
// domain, so CI cannot probe it directly. 2026 practice for a background
// service is a heartbeat written to a store the verifier can read, which proves
// the process BOOTED AND REACHED ITS DEPENDENCIES -- strictly stronger than
// grepping a log line, which only proves a string was printed and depends on
// log retention and on the very stream that `railway up` already fails to
// deliver reliably.
//
// WHY A TTL. Provenance that outlives the process would let CI verify a worker
// that has since died. The key must expire, so a stale heartbeat reads as
// absent and fails closed.
import { describe, it, expect } from 'vitest';
import { testSha } from '@fleet/test-fixtures';
import { DeployVersionSchema } from '@fleet/sync-protocol';
import {
  WORKER_PROVENANCE_KEY,
  WORKER_PROVENANCE_TTL_SECONDS,
  buildBootProvenance,
  bootProvenanceSetArgs,
} from '../src/boot-provenance.js';

const SHA = testSha(1);
const AT = '2026-08-03T09:00:00.000Z';
const at = (): string => AT;

describe('WORKER_PROVENANCE_KEY', () => {
  // A fixed, namespaced key: the api reader and the worker writer must agree
  // without either restating the literal.
  it('is a single stable key both writer and reader import', () => {
    expect(WORKER_PROVENANCE_KEY).toBe('fleet:worker:provenance');
  });
});

describe('WORKER_PROVENANCE_TTL_SECONDS', () => {
  // Long enough to survive a deploy verification window with room to spare,
  // short enough that a dead worker stops answering well inside one shift.
  it('expires so a dead worker cannot keep reporting', () => {
    expect(WORKER_PROVENANCE_TTL_SECONDS).toBeGreaterThan(0);
    expect(WORKER_PROVENANCE_TTL_SECONDS).toBeLessThanOrEqual(3600);
  });
});

describe('buildBootProvenance', () => {
  it('answers the SAME contract api and ops-web answer', () => {
    const v = buildBootProvenance({ GIT_SHA: SHA, GIT_BRANCH: 'main' }, at);
    expect(DeployVersionSchema.parse(v).sha).toBe(SHA);
  });

  it('reports unknown when nothing was stamped, rather than inventing a sha', () => {
    expect(buildBootProvenance({}, at).sha).toBe('unknown');
  });
});

describe('bootProvenanceSetArgs', () => {
  it('writes the payload as JSON under the shared key', () => {
    const args = bootProvenanceSetArgs(buildBootProvenance({ GIT_SHA: SHA }, at));
    expect(args[0]).toBe(WORKER_PROVENANCE_KEY);
    // args is a fixed 4-tuple, so args[1] is string -- no ?? fallback is
    // reachable, and lint rejects one as dead code.
    expect(DeployVersionSchema.parse(JSON.parse(args[1])).sha).toBe(SHA);
  });

  // EX (not PERSIST): an entry that never expires would let CI verify a worker
  // that died hours ago -- the stale-provenance failure this guards against.
  it('always sets an expiry', () => {
    const args = bootProvenanceSetArgs(buildBootProvenance({ GIT_SHA: SHA }, at));
    expect(args).toContain('EX');
    expect(args[args.indexOf('EX') + 1]).toBe(String(WORKER_PROVENANCE_TTL_SECONDS));
  });

  it('never writes a key that outlives the process', () => {
    const args = bootProvenanceSetArgs(buildBootProvenance({ GIT_SHA: SHA }, at));
    expect(args).not.toContain('PERSIST');
    expect(args).not.toContain('KEEPTTL');
  });
});
