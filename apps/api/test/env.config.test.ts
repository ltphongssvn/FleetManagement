// apps/api/test/env.config.test.ts
import { describe, it, expect } from 'vitest';
import { validateEnv } from '../src/config/env.config.js';

describe('@fleet/api - validateEnv', () => {
  const validBase = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://localhost:5432/fleet_test',
  };

  it('accepts valid env with defaults', () => {
    const env = validateEnv(validBase);
    expect(env.PORT).toBe(3000);
    expect(env.DB_POOL_MAX).toBe(10);
    expect(env.DB_IDLE_TIMEOUT_MS).toBe(30_000);
  });

  it('coerces numeric env vars from strings', () => {
    const env = validateEnv({ ...validBase, PORT: '8080', DB_POOL_MAX: '50' });
    expect(env.PORT).toBe(8080);
    expect(env.DB_POOL_MAX).toBe(50);
  });

  it('reports DATABASE_URL path when missing', () => {
    expect(() => validateEnv({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/);
  });

  it('reports DATABASE_URL path when malformed', () => {
    expect(() => validateEnv({ ...validBase, DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });

  it('reports NODE_ENV path on invalid value', () => {
    expect(() => validateEnv({ ...validBase, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
