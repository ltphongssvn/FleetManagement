// scripts/railway-watch-patterns.guard.test.ts
// Static watch paths have two failure modes: over-build (wasteful) and
// under-build (dangerous -- the shared library nobody's filter lists, so the
// service silently ships stale code). This guard derives main-worker's REAL
// workspace dependencies from its package.json and asserts every one is
// covered by a watch pattern, so adding a @fleet/* dep fails here instead of
// producing a worker built without it.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..');

const readJson = (p: string): Record<string, unknown> =>
  JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;

/** name -> repo-relative directory, discovered rather than hardcoded. */
const workspaceDirs = (): Map<string, string> => {
  const found = new Map<string, string>();
  for (const root of ['packages', 'apps', 'workers']) {
    const abs = join(REPO_ROOT, root);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs)) {
      const manifest = join(abs, entry, 'package.json');
      if (!existsSync(manifest)) continue;
      const name = readJson(manifest)['name'];
      if (typeof name === 'string') found.set(name, `${root}/${entry}`);
    }
  }
  return found;
};

const workerConfig = readJson(join(REPO_ROOT, 'workers/main-worker/railway.json'));
const workerManifest = readJson(join(REPO_ROOT, 'workers/main-worker/package.json'));

const watchPatterns = (workerConfig['build'] as Record<string, unknown>)[
  'watchPatterns'
] as string[];

const workspaceDeps = (): string[] => {
  const deps = (workerManifest['dependencies'] ?? {}) as Record<string, string>;
  return Object.entries(deps)
    .filter(([, spec]) => spec.startsWith('workspace:'))
    .map(([name]) => name);
};

const isCovered = (dir: string): boolean =>
  watchPatterns.some((p) => p === `${dir}/**` || p === dir);

describe('worker railway.json watch patterns', () => {
  it('declares a non-empty pattern list', () => {
    expect(watchPatterns.length).toBeGreaterThan(0);
  });

  it('covers its own source directory', () => {
    expect(isCovered('workers/main-worker')).toBe(true);
  });

  it('covers the lockfile and its Dockerfile', () => {
    expect(watchPatterns).toContain('pnpm-lock.yaml');
    expect(watchPatterns).toContain('Dockerfile.worker');
  });

  it('covers every workspace dependency it declares', () => {
    const dirs = workspaceDirs();
    const uncovered = workspaceDeps()
      .map((name) => ({ name, dir: dirs.get(name) }))
      .filter(({ dir }) => dir === undefined || !isCovered(dir))
      .map(({ name, dir }) => `${name} (${dir ?? 'unresolved'})`);
    expect(uncovered).toEqual([]);
  });

  it('pins restart retries at 3', () => {
    expect((workerConfig['deploy'] as Record<string, unknown>)['restartPolicyMaxRetries']).toBe(3);
  });
});
