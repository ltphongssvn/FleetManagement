// test/mutation-ci.test.ts
// TDD RED: nightly workflow must run mutation testing on schedule.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('.github/workflows/mutation.yml', () => {
  const path = resolve(__dirname, '../.github/workflows/mutation.yml');

  it('exists', () => {
    expect(existsSync(path)).toBe(true);
  });

  it('runs on schedule (nightly), not on every push', () => {
    const yml = readFileSync(path, 'utf8');
    expect(yml).toMatch(/schedule:/);
    expect(yml).toMatch(/cron:/);
  });

  it('invokes test:mutation script', () => {
    const yml = readFileSync(path, 'utf8');
    expect(yml).toMatch(/test:mutation/);
  });
});
