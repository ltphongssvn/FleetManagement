// scripts/e2e/stack-e2e-isolated.test.ts
// Contract for the ISOLATED browser-E2E runner. Composes the existing
// per-worktree compose identity (compose-identity.ts identityFor) into a
// committed, rediscoverable op that raises the app-only stack on the worktree
// ports and runs Playwright against them -- replacing the ad-hoc docker compose
// + inline E2E_* env anti-pattern. Pure planners describe WHAT to do; the
// side-effecting main() is entrypoint-only.
import { describe, it, expect } from 'vitest';
import { identityFor } from '../compose-identity.ts';
import {
  e2eEnvFromIdentity,
  browserE2EServices,
  browserE2EReadiness,
  shouldTakeHostLock,
  selfUnderLockCommand,
  HOST_LOCK_ENV,
  HOST_LOCK_WAIT_SECONDS,
  hostLockTimeoutMessage,
  isLockTimeoutExit,
} from './stack-e2e-isolated.ts';

// A concrete identity for a fixed worktree root, so the derived URLs/ports are
// deterministic (same key algorithm the compose + testcontainers layers share).
const ID = identityFor('/home/dev/code/ltphongssvn/t16-wt1-isolated-e2e-runner');

describe('e2eEnvFromIdentity', () => {
  it('derives E2E_BASE_URL from the ops-web port and E2E_API_URL from the api port', () => {
    const env = e2eEnvFromIdentity(ID);
    expect(env.E2E_BASE_URL).toBe('http://localhost:' + String(ID.ports.OPS_WEB));
    expect(env.E2E_API_URL).toBe('http://localhost:' + String(ID.ports.API));
  });
  it('produces only localhost URLs (browser E2E runs against the local isolated stack)', () => {
    const env = e2eEnvFromIdentity(ID);
    expect(env.E2E_BASE_URL.startsWith('http://localhost:')).toBe(true);
    expect(env.E2E_API_URL.startsWith('http://localhost:')).toBe(true);
  });
  // Regression guard (2026-07-23): ops-web-login.spec asserts that startLogin
  // redirects to the CONFIGURED authorize endpoint. When the runner did not
  // inject OIDC_AUTHORIZATION_ENDPOINT, the spec fell back to the
  // playwright.config placeholder (https://kc.e2e.example/...) while the
  // isolated stack redirected to its own mock-oauth2 on the identity OAUTH
  // port -- a guaranteed mismatch that looked like a product failure. The
  // endpoint must therefore be derived from the SAME identity as every other
  // URL, never left to a placeholder.
  it('derives OIDC_AUTHORIZATION_ENDPOINT from the identity OAUTH port', () => {
    const env = e2eEnvFromIdentity(ID);
    expect(env.OIDC_AUTHORIZATION_ENDPOINT).toBe(
      'http://localhost:' + String(ID.ports.OAUTH) + '/fleet/authorize',
    );
  });
  it('never leaves the authorize endpoint pointing at the kc.e2e.example placeholder', () => {
    const env = e2eEnvFromIdentity(ID);
    expect(env.OIDC_AUTHORIZATION_ENDPOINT).not.toContain('kc.e2e.example');
    expect(env.OIDC_AUTHORIZATION_ENDPOINT.startsWith('http://localhost:')).toBe(true);
  });
  it('points the authorize endpoint at the mock IdP port, not the api or ops-web port', () => {
    const env = e2eEnvFromIdentity(ID);
    expect(env.OIDC_AUTHORIZATION_ENDPOINT).not.toContain(':' + String(ID.ports.API) + '/');
    expect(env.OIDC_AUTHORIZATION_ENDPOINT).not.toContain(':' + String(ID.ports.OPS_WEB) + '/');
  });
});

describe('browserE2EServices', () => {
  it('lists the app-only stack: infra + api + ops-web, in dependency-safe order', () => {
    const svc = browserE2EServices();
    for (const s of ['postgres', 'redis', 'mock-oauth2', 'localstack', 'api', 'ops-web']) {
      expect(svc).toContain(s);
    }
    expect(svc.indexOf('postgres')).toBeLessThan(svc.indexOf('api'));
    expect(svc.indexOf('api')).toBeLessThan(svc.indexOf('ops-web'));
  });
  it('EXCLUDES the driver-app / expo / android services (browser-only, not phone)', () => {
    const svc = browserE2EServices();
    expect(svc).not.toContain('driver-app');
    expect(svc).not.toContain('expo');
    expect(svc).not.toContain('android');
  });
});

describe('browserE2EReadiness', () => {
  it('derives the api /health/ready probe and the ops-web base from the identity ports', () => {
    const targets = browserE2EReadiness(ID);
    expect(targets).toContain('http://localhost:' + String(ID.ports.API) + '/health/ready');
    expect(targets).toContain('http://localhost:' + String(ID.ports.OPS_WEB));
  });
});

// Host-lock enrollment. gate:integration has queued behind a host-wide flock
// since fab24dd, and 742e1f7 put it on the same inode as the pre-push coverage
// hook. The isolated E2E stack was never enrolled -- yet it is by far the
// heaviest consumer on this host: seven containers plus a --no-cache rebuild
// of two app images. So the two guarded gates politely queued for each other
// while the biggest one barged straight through, which is how a sibling
// worktree could still starve a run that had done everything right.
//
// The runner cannot simply wrap its own body: flock(1) holds the lock for the
// lifetime of a CHILD process. The runner therefore re-executes ITSELF under
// flock, and a sentinel env var stops that recursing forever.
describe('host-lock enrollment', () => {
  // flock(1) exits 1 on -w timeout with NOTHING on stderr, which is
  // indistinguishable from a failing test run. Observed live: a sibling
  // gate held the lock, this runner waited the full budget and died silently
  // after an hour. An uninterpretable run is precisely what host-gate exists
  // to prevent, so the timeout must be named as a timeout.
  it('explains a lock timeout instead of failing silently', () => {
    const msg = hostLockTimeoutMessage('/l.lock', 3600);
    expect(msg).toContain('timed out');
    expect(msg).toContain('/l.lock');
    expect(msg).toContain('3600');
  });

  // A timeout is a HOST condition, not a product failure. Distinguishing it
  // from a genuine spec failure is what stops a queued run being triaged as
  // a broken feature.
  it('classifies the flock timeout exit code distinctly', () => {
    expect(isLockTimeoutExit(1, true)).toBe(true);
    expect(isLockTimeoutExit(1, false)).toBe(false);
    expect(isLockTimeoutExit(0, true)).toBe(false);
  });

  // E2E is not gate:integration. A full isolated stack runs ~25 minutes, so
  // a handful of legitimately queued siblings exceeds an hour without any
  // fault. The budget must exceed several sibling runs, not one.
  it('budgets enough wait for several sibling E2E runs', () => {
    expect(HOST_LOCK_WAIT_SECONDS).toBeGreaterThanOrEqual(4 * 25 * 60);
  });

  it('takes the lock when the sentinel is absent', () => {
    expect(shouldTakeHostLock({})).toBe(true);
  });

  it('does NOT retake the lock once held (no infinite re-exec)', () => {
    expect(shouldTakeHostLock({ [HOST_LOCK_ENV]: '1' })).toBe(false);
  });

  it('ignores a sentinel set to anything other than 1', () => {
    expect(shouldTakeHostLock({ [HOST_LOCK_ENV]: '' })).toBe(true);
    expect(shouldTakeHostLock({ [HOST_LOCK_ENV]: '0' })).toBe(true);
  });

  it('re-executes THIS script with the original arguments preserved', () => {
    const cmd = selfUnderLockCommand(
      '/home/u/.cache/fleetmanagement/gate.lock',
      ['/usr/bin/node', '/w/scripts/e2e/stack-e2e-isolated.ts'],
      ['e2e/a.spec.ts', 'e2e/b.spec.ts'],
    );
    expect(cmd[0]).toBe('flock');
    expect(cmd).toContain('/home/u/.cache/fleetmanagement/gate.lock');
    expect(cmd).toContain('e2e/a.spec.ts');
    expect(cmd).toContain('e2e/b.spec.ts');
    expect(cmd).not.toContain('--');
  });

  it('queues rather than failing fast, and never waits forever', () => {
    const cmd = selfUnderLockCommand('/l.lock', ['node', 's.ts'], []);
    const w = cmd.indexOf('-w');
    expect(w).toBeGreaterThanOrEqual(0);
    const budget = Number(cmd[w + 1]);
    expect(budget).toBeGreaterThan(0);
    expect(Number.isFinite(budget)).toBe(true);
  });
});
