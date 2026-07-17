// workers/main-worker/test/config-oidc.test.ts
// RED (phieu-photo-visibility arc, slice B): worker env contract swaps the
// static FLEET_API_TOKEN (root cause: silent JWT expiry, 65 manifests stuck
// in verifying since Jun-24) for OAuth2 client-credentials inputs.
//   - WORKER_OIDC_TOKEN_URL   full Keycloak token endpoint (one URL, no
//     realm-path assembly -> kills the /auth-prefix drift class)
//   - WORKER_OIDC_CLIENT_ID / WORKER_OIDC_CLIENT_SECRET
// All three optional (pilot-safe boot: absent -> callbacks skip, mirroring
// FLEET_API_URL gating) with the codified empty-string-means-absent
// preprocess (compose substitutes unset vars as EMPTY STRING).
// FLEET_API_TOKEN must be GONE from the schema: strip mode drops it even
// when the env still carries it (stale Railway var cannot resurrect the
// static-token path).
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config.js';

const asRecord = (v: unknown): Record<string, unknown> => v as Record<string, unknown>;

// Runtime-generated credential value: no credential-shaped literal in the
// file (locked scanner rule); the env KEY stays the real contract name and
// carries a variable value, which scanners accept.
const CRED = 'cred-' + randomBytes(6).toString('hex');

describe('worker OIDC client-credentials config', () => {
  it('boots with all OIDC vars absent (pilot-safe: callbacks skip)', () => {
    const config = asRecord(loadConfig({}));
    expect(config['WORKER_OIDC_TOKEN_URL']).toBeUndefined();
    expect(config['WORKER_OIDC_CLIENT_ID']).toBeUndefined();
    expect(config['WORKER_OIDC_CLIENT_SECRET']).toBeUndefined();
  });

  it('accepts the full OIDC trio', () => {
    const config = asRecord(
      loadConfig({
        WORKER_OIDC_TOKEN_URL: 'https://kc.example.test/realms/fleet/protocol/openid-connect/token',
        WORKER_OIDC_CLIENT_ID: 'fleet-worker',
        WORKER_OIDC_CLIENT_SECRET: CRED,
      }),
    );
    expect(config['WORKER_OIDC_TOKEN_URL']).toBe(
      'https://kc.example.test/realms/fleet/protocol/openid-connect/token',
    );
    expect(config['WORKER_OIDC_CLIENT_ID']).toBe('fleet-worker');
    expect(config['WORKER_OIDC_CLIENT_SECRET']).toBe(CRED);
  });

  it('treats compose empty-string substitutions as ABSENT, not a boot crash', () => {
    const config = asRecord(
      loadConfig({
        WORKER_OIDC_TOKEN_URL: '',
        WORKER_OIDC_CLIENT_ID: '',
        WORKER_OIDC_CLIENT_SECRET: '',
      }),
    );
    expect(config['WORKER_OIDC_TOKEN_URL']).toBeUndefined();
    expect(config['WORKER_OIDC_CLIENT_ID']).toBeUndefined();
    expect(config['WORKER_OIDC_CLIENT_SECRET']).toBeUndefined();
  });

  it('rejects a malformed WORKER_OIDC_TOKEN_URL', () => {
    expect(() => loadConfig({ WORKER_OIDC_TOKEN_URL: 'not-a-url' })).toThrow(/Invalid environment/);
  });

  it('FLEET_API_TOKEN is no longer part of the contract (stripped even when set)', () => {
    const config = asRecord(loadConfig({ FLEET_API_TOKEN: 'stale-static-jwt' }));
    expect('FLEET_API_TOKEN' in config).toBe(false);
  });
});
