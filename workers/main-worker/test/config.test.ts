// workers/main-worker/test/config.test.ts
// TDD: verify env validation fails fast on malformed input.
// FLEET_API_TOKEN tests removed with the static-token contract (slice B of
// the phieu-photo-visibility arc); its removal is guarded in
// config-oidc.test.ts (stripped-even-when-set) and the replacement
// WORKER_OIDC_* trio is covered there too.
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';
describe('@fleet/main-worker -- config validation', () => {
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
  it('should accept a multi-character ERP_API_KEY (min length, not max)', () => {
    const cfg = loadConfig({ ERP_API_KEY: 'key-abcdefghijklmnop' });
    expect(cfg.ERP_API_KEY).toBe('key-abcdefghijklmnop');
  });
  it('should reject an empty-string ERP_API_KEY', () => {
    expect(() => loadConfig({ ERP_API_KEY: '' })).toThrow(/Invalid environment/);
  });
});
