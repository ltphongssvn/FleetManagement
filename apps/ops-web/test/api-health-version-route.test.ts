// apps/ops-web/test/api-health-version-route.test.ts
// RED: ops-web must report WHICH COMMIT is live, exactly as api does.
//
// THE GAP. railway-deploy already stamps GIT_SHA on ops-web (deploy-stamp
// --stamp --service ops-web), but nothing reads it back: the deploy is gated
// only by /login returning 200, and the PREVIOUS container answers that
// perfectly after a failed deploy. Liveness cannot distinguish "new version
// live" from "old version still serving", so ops-web could sit a release
// behind while CI reported success.
//
// A route handler runs SERVER-SIDE, so process.env is readable at runtime --
// no Dockerfile change, no NEXT_PUBLIC_ exposure. proxy.ts already excludes
// api/health from the auth matcher, so CI probes it unauthenticated exactly as
// it probes api, and both services answer one contract.
//
// EVERY response is read through DeployVersionSchema.parse, never a cast. A
// cast would compile while the contract drifted underneath it -- the failure
// this endpoint exists to catch. parse (not safeParse().success) is deliberate:
// a bare true/false assertion hides WHICH field broke, while parse throws the
// ZodError naming it.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { testSha, INVALID_SHA_FIXTURES } from '@fleet/test-fixtures';
import { DeployVersionSchema, type DeployVersion } from '@fleet/sync-protocol';
import { GET } from '@/app/api/health/version/route';

const SHA = testSha(1);
const PLATFORM_SHA = testSha(2);

// vi.stubEnv over process.env mutation: reassigning the global leaks between
// files and races under concurrent runs; unstubAllEnvs restores exactly.
afterEach(() => {
  vi.unstubAllEnvs();
});

// GET is SYNCHRONOUS: the handler reads process.env and returns immediately,
// with no I/O to await. Only res.json() is async. Awaiting GET() would be a
// non-thenable await -- lint rejects it, and it would misstate the handler's
// shape to anyone reading the test.
async function readVersion(): Promise<{ res: Response; body: DeployVersion }> {
  const res = GET();
  const body: unknown = await res.json();
  return { res, body: DeployVersionSchema.parse(body) };
}

describe('ops-web GET /api/health/version', () => {
  it('answers the shared deploy-version contract', async () => {
    vi.stubEnv('GIT_SHA', SHA);
    vi.stubEnv('GIT_BRANCH', 'main');
    const { res, body } = await readVersion();
    expect(res.status).toBe(200);
    expect(body.branch).toBe('main');
  });

  it('reports the stamped sha so deploy-stamp --verify can compare it', async () => {
    vi.stubEnv('GIT_SHA', SHA);
    const { body } = await readVersion();
    expect(body.sha).toBe(SHA);
    expect(body.shortSha).toBe(SHA.slice(0, 7));
  });

  it('reports unknown when nothing was stamped, rather than inventing a sha', async () => {
    vi.stubEnv('GIT_SHA', undefined);
    vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', undefined);
    const { body } = await readVersion();
    expect(body.sha).toBe('unknown');
  });

  // Same blank-vs-absent rule as api: Docker bakes an unpassed ARG as the EMPTY
  // STRING, and counting blank as PRESENT is what made api report an empty sha
  // in production indefinitely.
  it('treats a blank GIT_SHA as absent, falling through to the platform var', async () => {
    vi.stubEnv('GIT_SHA', INVALID_SHA_FIXTURES.blank);
    vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', PLATFORM_SHA);
    const { body } = await readVersion();
    expect(body.sha).toBe(PLATFORM_SHA);
  });

  // A cached provenance response would let CI verify a STALE sha and pass a
  // deploy that never landed -- the exact false green this endpoint prevents.
  it('is never cached', async () => {
    vi.stubEnv('GIT_SHA', SHA);
    const { res } = await readVersion();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
