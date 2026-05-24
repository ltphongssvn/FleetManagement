// apps/driver-app/test/railway-config.test.ts
// TDD RED: driver-app railway.json must build Expo web export and serve statically.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('apps/driver-app/railway.json', () => {
  const path = resolve(__dirname, '../railway.json');

  it('exists', () => {
    expect(existsSync(path)).toBe(true);
  });

  it('builds Expo web export', () => {
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    expect(cfg.build.buildCommand).toMatch(/expo export.*--platform web/);
  });

  it('serves the dist directory', () => {
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    expect(cfg.deploy.startCommand).toMatch(/dist/);
  });

  it('declares ON_FAILURE restart policy', () => {
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    expect(cfg.deploy.restartPolicyType).toBe('ON_FAILURE');
  });
});
