// apps/api/test/health.version.controller.test.ts
// GET /health/version reports which COMMIT is live, so deploy-stamp --verify can
// fail the deploy when production is not running what CI just shipped. Liveness
// cannot make that call: /health/ready answers 200 from the PREVIOUS container.
//
// SHAS COME FROM A FACTORY, never hand-written. The originals were readable
// literals -- "commit-sha-fixture-1234567", "railwaysha9876543",
// "1111111explicit" -- none of which is a 40-hex sha, so this suite asserted
// shortSha values like "commit-" that git cannot produce and proved behaviour
// against an impossible shape. Editing the literals would fix the instance;
// testSha() makes the mistake unreachable.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { testSha, INVALID_SHA_FIXTURES } from '@fleet/test-fixtures';
import { HealthController } from '../src/health/health.controller.js';

const ORIG = process.env;
const EXPLICIT_SHA = testSha(1);
const PLATFORM_SHA = testSha(2);

// The version endpoint reads process.env only; the worker reader is irrelevant
// to it and throws, so a future coupling fails loudly rather than passing on a
// stub that quietly answers.
function makeCtl(): HealthController {
  return new HealthController(
    { query: () => Promise.resolve({}) } as never,
    (): Promise<string | null> => {
      throw new Error('version must not read worker provenance');
    },
  );
}

describe('@fleet/api - HealthController.version', () => {
  beforeEach(() => { process.env = { ...ORIG }; });
  afterEach(() => { process.env = ORIG; });

  it('returns sha/shortSha/branch/buildTime from RAILWAY_GIT_COMMIT_SHA env', () => {
    process.env['RAILWAY_GIT_COMMIT_SHA'] = PLATFORM_SHA;
    process.env['RAILWAY_GIT_BRANCH'] = 'main';
    const v = makeCtl().version();
    expect(v.sha).toBe(PLATFORM_SHA);
    expect(v.shortSha).toBe(PLATFORM_SHA.slice(0, 7));
    expect(v.branch).toBe('main');
    expect(typeof v.buildTime).toBe('string');
  });

  it('falls back to unknown when no commit env is present', () => {
    delete process.env['RAILWAY_GIT_COMMIT_SHA'];
    delete process.env['GIT_SHA'];
    delete process.env['RAILWAY_GIT_BRANCH'];
    delete process.env['GIT_BRANCH'];
    const v = makeCtl().version();
    expect(v.sha).toBe('unknown');
    expect(v.shortSha).toBe('unknown');
    expect(v.branch).toBe('unknown');
  });

  it('prefers GIT_SHA over RAILWAY_GIT_COMMIT_SHA when both set', () => {
    process.env['GIT_SHA'] = EXPLICIT_SHA;
    process.env['RAILWAY_GIT_COMMIT_SHA'] = PLATFORM_SHA;
    expect(makeCtl().version().sha).toBe(EXPLICIT_SHA);
  });
});

// Blank-env handling. Dockerfile.api declares ARG RAILWAY_GIT_COMMIT_SHA and
// then ENV GIT_SHA=$ARG. Docker substitutes an unpassed ARG with the EMPTY
// STRING, so the image ships GIT_SHA set-but-blank. Nullish coalescing treats
// blank as PRESENT, so it won over the value the platform injects at runtime
// and /health/version reported an empty sha in production forever -- the deploy
// gate could never confirm which commit was live.
describe('@fleet/api - HealthController.version blank env', () => {
  beforeEach(() => { process.env = { ...ORIG }; });
  afterEach(() => { process.env = ORIG; });

  it('treats an EMPTY GIT_SHA as absent, falling through to the platform var', () => {
    process.env['GIT_SHA'] = INVALID_SHA_FIXTURES.blank;
    process.env['RAILWAY_GIT_COMMIT_SHA'] = PLATFORM_SHA;
    const v = makeCtl().version();
    expect(v.sha).toBe(PLATFORM_SHA);
    expect(v.shortSha).toBe(PLATFORM_SHA.slice(0, 7));
  });

  it('treats a WHITESPACE-ONLY GIT_SHA as absent', () => {
    process.env['GIT_SHA'] = '   ';
    process.env['RAILWAY_GIT_COMMIT_SHA'] = PLATFORM_SHA;
    expect(makeCtl().version().sha).toBe(PLATFORM_SHA);
  });

  it('reports unknown when BOTH sha vars are blank', () => {
    process.env['GIT_SHA'] = INVALID_SHA_FIXTURES.blank;
    process.env['RAILWAY_GIT_COMMIT_SHA'] = INVALID_SHA_FIXTURES.blank;
    const v = makeCtl().version();
    expect(v.sha).toBe('unknown');
    expect(v.shortSha).toBe('unknown');
  });

  it('treats an EMPTY GIT_BRANCH as absent, falling through to the platform var', () => {
    process.env['GIT_BRANCH'] = '';
    process.env['RAILWAY_GIT_BRANCH'] = 'develop';
    expect(makeCtl().version().branch).toBe('develop');
  });

  it('reports unknown when BOTH branch vars are blank', () => {
    process.env['GIT_BRANCH'] = '';
    process.env['RAILWAY_GIT_BRANCH'] = '';
    expect(makeCtl().version().branch).toBe('unknown');
  });

  it('falls back to a real timestamp when BUILD_TIME is blank', () => {
    process.env['BUILD_TIME'] = '';
    expect(makeCtl().version().buildTime.length).toBeGreaterThan(0);
  });
});

// The boundary check the fictional fixtures were hiding: a value that is not a
// commit sha must fail at the SOURCE, naming the offending stamp, rather than
// being served as provenance and failing later in CI as an opaque mismatch
// that blames the deploy for what is really a stamping bug.
describe('@fleet/api - HealthController.version rejects a malformed stamp', () => {
  beforeEach(() => { process.env = { ...ORIG }; });
  afterEach(() => { process.env = ORIG; });

  it('throws when a release TAG was stamped instead of a sha', () => {
    process.env['GIT_SHA'] = INVALID_SHA_FIXTURES.releaseTag;
    expect(() => makeCtl().version()).toThrow();
  });

  it('throws when the sha is truncated', () => {
    process.env['GIT_SHA'] = INVALID_SHA_FIXTURES.truncated;
    expect(() => makeCtl().version()).toThrow();
  });

  it('throws on uppercase hex, which CI could never match', () => {
    process.env['GIT_SHA'] = INVALID_SHA_FIXTURES.uppercase;
    expect(() => makeCtl().version()).toThrow();
  });
});
