// workers/main-worker/test/config.test.ts
// TDD: verify env validation fails fast on malformed input.
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('@fleet/main-worker — config validation', () => {
  it('should accept valid env', () => {
    const cfg = loadConfig({ REDIS_URL: 'redis://localhost:6379', NODE_ENV: 'test' });
    expect(cfg.REDIS_URL).toBe('redis://localhost:6379');
    expect(cfg.NODE_ENV).toBe('test');
  });

  it('should default REDIS_URL when missing', () => {
    const cfg = loadConfig({});
    expect(cfg.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('should reject malformed REDIS_URL', () => {
    expect(() => loadConfig({ REDIS_URL: 'not-a-url' })).toThrow(/Invalid environment/);
  });

  it('should reject invalid NODE_ENV', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/Invalid environment/);
  });
});
