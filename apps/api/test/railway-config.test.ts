// apps/api/test/railway-config.test.ts
// TDD RED: railway.json must declare Dockerfile build, healthcheck, restart policy.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('apps/api/railway.json', () => {
  const path = resolve(__dirname, '../railway.json');

  it('exists', () => {
    expect(existsSync(path)).toBe(true);
  });

  it('declares Dockerfile builder with api target', () => {
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    expect(cfg.build.builder).toBe('DOCKERFILE');
    expect(cfg.build.dockerfilePath).toBe('Dockerfile');
  });

  it('declares healthcheck on /health/ready', () => {
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    expect(cfg.deploy.healthcheckPath).toBe('/health/ready');
    expect(cfg.deploy.healthcheckTimeout).toBeGreaterThanOrEqual(60);
  });

  it('declares ON_FAILURE restart policy with max retries', () => {
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    expect(cfg.deploy.restartPolicyType).toBe('ON_FAILURE');
    expect(cfg.deploy.restartPolicyMaxRetries).toBeGreaterThanOrEqual(1);
  });
});
