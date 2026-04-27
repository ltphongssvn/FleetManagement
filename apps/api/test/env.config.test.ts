// apps/api/test/env.config.test.ts
import { describe, it, expect } from 'vitest';
import { validateEnv } from '../src/config/env.config.js';

describe('@fleet/api - validateEnv', () => {
  const validBase = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://localhost:5432/fleet_test',
    OIDC_ISSUER: 'https://idp.example.com/',
    OIDC_AUDIENCE: 'fleet-api',
    OIDC_JWKS_URI: 'https://idp.example.com/.well-known/jwks.json',
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
