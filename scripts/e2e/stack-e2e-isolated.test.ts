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
