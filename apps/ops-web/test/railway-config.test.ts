// apps/ops-web/test/railway-config.test.ts
// TDD RED: ops-web railway.json must use Dockerfile target.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('apps/ops-web/railway.json', () => {
  const path = resolve(__dirname, '../railway.json');

  it('exists', () => {
    expect(existsSync(path)).toBe(true);
  });

  it('declares Dockerfile builder', () => {
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    expect(cfg.build.builder).toBe('DOCKERFILE');
  });

  it('declares ON_FAILURE restart policy', () => {
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    expect(cfg.deploy.restartPolicyType).toBe('ON_FAILURE');
  });
});
