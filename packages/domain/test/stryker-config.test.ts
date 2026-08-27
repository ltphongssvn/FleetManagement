// packages/domain/test/stryker-config.test.ts
// TDD RED: Stryker config must scope to pure-logic + enforce thresholds.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('packages/domain/stryker.config.json', () => {
  const path = resolve(__dirname, '../stryker.config.json');

  it('exists', () => {
    expect(existsSync(path)).toBe(true);
  });

  it('uses vitest test runner', () => {
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    expect(cfg.testRunner).toBe('vitest');
  });

  it('mutates only src/ (excludes test/, dist/)', () => {
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    expect(cfg.mutate).toEqual(expect.arrayContaining(['src/**/*.ts']));
    expect(cfg.mutate.some((p: string) => p.startsWith('!test') || p.includes('!**/test/'))).toBe(
      true,
    );
  });

  it('enforces break threshold to fail CI on regression', () => {
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    expect(cfg.thresholds.break).toBeGreaterThanOrEqual(70);
    expect(cfg.thresholds.high).toBeGreaterThanOrEqual(80);
    expect(cfg.thresholds.low).toBeGreaterThanOrEqual(60);
  });

  it('uses incremental caching for speed', () => {
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    expect(cfg.incremental).toBe(true);
  });
});
