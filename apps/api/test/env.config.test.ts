// apps/api/test/env.config.test.ts
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { validateEnv } from '../src/config/env.config.js';

describe('@fleet/api - validateEnv', () => {
  const validBase = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://localhost:5432/fleet_test',
    OIDC_ISSUER: 'https://idp.example.com/',
    OIDC_AUDIENCE: 'fleet-api',
    OIDC_JWKS_URI: 'https://idp.example.com/.well-known/jwks.json',
    AWS_REGION: 'us-west-2',
    S3_ARTIFACTS_BUCKET: 'fleet-test',
    OTEL_ENABLED: 'false',
    OTEL_SAMPLE_RATIO: '1.0',
  };

  describe('defaults', () => {
    it('PORT defaults to 3000', () => {
      expect(validateEnv(validBase).PORT).toBe(3000);
    });

    it('DB_POOL_MAX defaults to 10', () => {
      expect(validateEnv(validBase).DB_POOL_MAX).toBe(10);
    });

    it('DB_IDLE_TIMEOUT_MS defaults to 30_000', () => {
      expect(validateEnv(validBase).DB_IDLE_TIMEOUT_MS).toBe(30_000);
    });

    it('NODE_ENV defaults to development when omitted', () => {
      const { NODE_ENV: _omit, ...withoutEnv } = validBase;
      expect(validateEnv(withoutEnv).NODE_ENV).toBe('development');
    });

    it('REDIS_URL defaults to localhost', () => {
      expect(validateEnv(validBase).REDIS_URL).toBe('redis://localhost:6379');
    });
  });

  describe('coercion', () => {
    it('coerces PORT from string', () => {
      expect(validateEnv({ ...validBase, PORT: '8080' }).PORT).toBe(8080);
    });

    it('coerces DB_POOL_MAX from string', () => {
      expect(validateEnv({ ...validBase, DB_POOL_MAX: '50' }).DB_POOL_MAX).toBe(50);
    });
  });

  describe('rejection - DATABASE_URL', () => {
    it('reports DATABASE_URL path when missing', () => {
      const { DATABASE_URL: _o, ...rest } = validBase;
      expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
    });

    it('reports DATABASE_URL path when malformed', () => {
      expect(() => validateEnv({ ...validBase, DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
    });
  });

  describe('rejection - REDIS_URL', () => {
    it('rejects malformed REDIS_URL', () => {
      expect(() => validateEnv({ ...validBase, REDIS_URL: 'not-a-url' })).toThrow(/REDIS_URL/);
    });
  });

  describe('rejection - PORT', () => {
    it('rejects PORT=0 (must be positive)', () => {
      expect(() => validateEnv({ ...validBase, PORT: '0' })).toThrow(/PORT/);
    });

    it('rejects negative PORT', () => {
      expect(() => validateEnv({ ...validBase, PORT: '-1' })).toThrow(/PORT/);
    });

    it('rejects non-numeric PORT', () => {
      expect(() => validateEnv({ ...validBase, PORT: 'abc' })).toThrow(/PORT/);
    });
  });

  describe('rejection - NODE_ENV', () => {
    it('reports NODE_ENV path on invalid value', () => {
      expect(() => validateEnv({ ...validBase, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    });
  });

  describe('rejection - OIDC', () => {
    it('rejects missing OIDC_ISSUER', () => {
      const { OIDC_ISSUER: _o, ...rest } = validBase;
      expect(() => validateEnv(rest)).toThrow(/OIDC_ISSUER/);
    });

    it('rejects malformed OIDC_JWKS_URI', () => {
      expect(() => validateEnv({ ...validBase, OIDC_JWKS_URI: 'not-a-url' })).toThrow(/OIDC_JWKS_URI/);
    });

    it('rejects empty OIDC_AUDIENCE', () => {
      expect(() => validateEnv({ ...validBase, OIDC_AUDIENCE: '' })).toThrow(/OIDC_AUDIENCE/);
    });
  });
});


describe('@fleet/api - validateEnv (step-up requirement knobs)', () => {
  const base = {
    DATABASE_URL: 'postgres://localhost:5432/fleet_test',
    OIDC_ISSUER: 'https://idp.example.com/',
    OIDC_AUDIENCE: 'fleet-api',
    OIDC_JWKS_URI: 'https://idp.example.com/.well-known/jwks.json',
  };

  it('STEP_UP_ACR_LADDER defaults weakest->strongest', () => {
    expect(validateEnv(base).STEP_UP_ACR_LADDER).toEqual(['aal1', 'aal2', 'aal3']);
  });

  it('STEP_UP_ACR_LADDER parses a comma-separated override and trims', () => {
    expect(validateEnv({ ...base, STEP_UP_ACR_LADDER: ' low , high ' }).STEP_UP_ACR_LADDER).toEqual([
      'low',
      'high',
    ]);
  });

  it('STEP_UP_DISPATCH_REQUIRED_ACR defaults to aal2', () => {
    expect(validateEnv(base).STEP_UP_DISPATCH_REQUIRED_ACR).toBe('aal2');
  });

  it('STEP_UP_DISPATCH_REQUIRE_PHISHING_RESISTANT defaults to false', () => {
    expect(validateEnv(base).STEP_UP_DISPATCH_REQUIRE_PHISHING_RESISTANT).toBe(false);
  });

  it('STEP_UP_DISPATCH_REQUIRE_PHISHING_RESISTANT coerces "true" to boolean', () => {
    expect(
      validateEnv({ ...base, STEP_UP_DISPATCH_REQUIRE_PHISHING_RESISTANT: 'true' })
        .STEP_UP_DISPATCH_REQUIRE_PHISHING_RESISTANT,
    ).toBe(true);
  });

  it('STEP_UP_PHISHING_RESISTANT_AMR defaults to [hwk]', () => {
    expect(validateEnv(base).STEP_UP_PHISHING_RESISTANT_AMR).toEqual(['hwk']);
  });

  it('STEP_UP_PHISHING_RESISTANT_AMR parses a comma-separated override', () => {
    expect(
      validateEnv({ ...base, STEP_UP_PHISHING_RESISTANT_AMR: 'hwk, fido2' }).STEP_UP_PHISHING_RESISTANT_AMR,
    ).toEqual(['hwk', 'fido2']);
  });
});


describe('@fleet/api - validateEnv (break-glass monitor knobs)', () => {
  const base = {
    DATABASE_URL: 'postgres://localhost:5432/fleet_test',
    OIDC_ISSUER: 'https://idp.example.com/',
    OIDC_AUDIENCE: 'fleet-api',
    OIDC_JWKS_URI: 'https://idp.example.com/.well-known/jwks.json',
  };

  it('KEYCLOAK_BASE_URL defaults to the production Keycloak host', () => {
    expect(validateEnv(base).KEYCLOAK_BASE_URL).toBe('https://keycloak-production-7959.up.railway.app');
  });

  it('KEYCLOAK_BASE_URL accepts an override URL', () => {
    expect(validateEnv({ ...base, KEYCLOAK_BASE_URL: 'https://kc.example.com' }).KEYCLOAK_BASE_URL).toBe(
      'https://kc.example.com',
    );
  });

  it('KEYCLOAK_BASE_URL rejects a malformed URL', () => {
    expect(() => validateEnv({ ...base, KEYCLOAK_BASE_URL: 'not-a-url' })).toThrow(/KEYCLOAK_BASE_URL/);
  });

  it('KEYCLOAK_MONITOR_CLIENT_ID defaults to fleet-breakglass-monitor', () => {
    expect(validateEnv(base).KEYCLOAK_MONITOR_CLIENT_ID).toBe('fleet-breakglass-monitor');
  });

  it('KEYCLOAK_MONITOR_CLIENT_SECRET is optional and undefined when absent (monitor dormant)', () => {
    expect(validateEnv(base).KEYCLOAK_MONITOR_CLIENT_SECRET).toBeUndefined();
  });

  it('KEYCLOAK_MONITOR_CLIENT_SECRET is preserved when provided', () => {
    // Runtime-generated to avoid a credential-shaped literal (secret-scanner clean).
    const monitorSecret = `mon_${randomBytes(12).toString('hex')}`;
    expect(
      validateEnv({ ...base, KEYCLOAK_MONITOR_CLIENT_SECRET: monitorSecret }).KEYCLOAK_MONITOR_CLIENT_SECRET,
    ).toBe(monitorSecret);
  });

  it('BREAKGLASS_USERNAME_PREFIX defaults to fleet-breakglass', () => {
    expect(validateEnv(base).BREAKGLASS_USERNAME_PREFIX).toBe('fleet-breakglass');
  });

  it('BREAKGLASS_USERNAME_PREFIX accepts an override', () => {
    expect(validateEnv({ ...base, BREAKGLASS_USERNAME_PREFIX: 'emergency-admin' }).BREAKGLASS_USERNAME_PREFIX).toBe(
      'emergency-admin',
    );
  });

  it('BREAKGLASS_POLL_INTERVAL_MS defaults to 60_000', () => {
    expect(validateEnv(base).BREAKGLASS_POLL_INTERVAL_MS).toBe(60_000);
  });

  it('BREAKGLASS_POLL_INTERVAL_MS coerces from string', () => {
    expect(validateEnv({ ...base, BREAKGLASS_POLL_INTERVAL_MS: '30000' }).BREAKGLASS_POLL_INTERVAL_MS).toBe(30_000);
  });

  it('BREAKGLASS_POLL_INTERVAL_MS rejects a non-positive value', () => {
    expect(() => validateEnv({ ...base, BREAKGLASS_POLL_INTERVAL_MS: '0' })).toThrow(/BREAKGLASS_POLL_INTERVAL_MS/);
  });
});
