// test/e2e/image-size.e2e.test.ts
// RED: Production runtime images must not ship dev deps (vitest/eslint/etc) or workspace dist sources.
// Industry baseline: API + worker each < 600 MB, ops-web < 400 MB.
// These limits catch regressions where someone copies the full root node_modules into runtime.
import { execSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

function imageSizeMB(name: string): number {
  const out = execSync(`docker image inspect ${name} --format='{{.Size}}'`, { encoding: 'utf8' }).trim();
  return Math.round(Number(out) / 1024 / 1024);
}

function imageDirSizeMB(name: string, path: string): number {
  try {
    const out = execSync(
      `docker run --rm --entrypoint sh ${name} -c "du -sm ${path} 2>/dev/null | awk '{print \$1}'"`,
      { encoding: 'utf8' },
    ).trim();
    return Number(out) || 0;
  } catch {
    return 0;
  }
}

describe('runtime image size budgets', () => {
  it('fleet-pilot-api total size <= 600 MB', () => {
    expect(imageSizeMB('fleet-pilot-api:latest')).toBeLessThanOrEqual(600);
  });
  it('fleet-pilot-worker total size <= 600 MB', () => {
    expect(imageSizeMB('fleet-pilot-worker:latest')).toBeLessThanOrEqual(600);
  });
  it('fleet-pilot-ops-web total size <= 400 MB', () => {
    expect(imageSizeMB('fleet-pilot-ops-web:latest')).toBeLessThanOrEqual(400);
  });
  it('api image does not ship dev tooling (vitest/eslint absent)', () => {
    const out = execSync(
      `docker run --rm --entrypoint sh fleet-pilot-api:latest -c "ls /repo/node_modules/.pnpm 2>/dev/null | grep -E '^(vitest|eslint|typescript|drizzle-kit|@stryker)' | head -5 || true"`,
      { encoding: 'utf8' },
    ).trim();
    expect(out).toBe('');
  });
});
