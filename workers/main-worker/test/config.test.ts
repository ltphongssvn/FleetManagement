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
  it('should accept NODE_ENV=production (full enum membership)', () => {
    const cfg = loadConfig({ NODE_ENV: 'production' });
    expect(cfg.NODE_ENV).toBe('production');
  });
  it('should accept NODE_ENV=development (full enum membership)', () => {
    const cfg = loadConfig({ NODE_ENV: 'development' });
    expect(cfg.NODE_ENV).toBe('development');
  });
  it('should accept a multi-character FLEET_API_TOKEN (min length, not max)', () => {
    const cfg = loadConfig({ FLEET_API_TOKEN: 'tok-abcdefghijklmnop' });
    expect(cfg.FLEET_API_TOKEN).toBe('tok-abcdefghijklmnop');
  });
  it('should treat an empty-string FLEET_API_TOKEN as absent (compose blank-string substitution)', () => {
    expect(loadConfig({ FLEET_API_TOKEN: '' }).FLEET_API_TOKEN).toBeUndefined();
  });
  it('should accept a multi-character ERP_API_KEY (min length, not max)', () => {
    const cfg = loadConfig({ ERP_API_KEY: 'key-abcdefghijklmnop' });
    expect(cfg.ERP_API_KEY).toBe('key-abcdefghijklmnop');
  });
  it('should reject an empty-string ERP_API_KEY', () => {
    expect(() => loadConfig({ ERP_API_KEY: '' })).toThrow(/Invalid environment/);
  });
});
