// scripts/worker-watch-patterns-parity.guard.test.ts
//
// TWO change-detection systems decide whether the worker deploys, and they must
// agree exactly:
//
//   * .github/workflows/railway-deploy.yml -- dorny/paths-filter decides whether
//     the deploy-worker JOB runs (and therefore whether GIT_SHA is stamped).
//   * workers/main-worker/railway.json watchPatterns -- Railway decides whether
//     it actually BUILDS. This applies to `railway up --ci` too, not only to
//     GitHub autodeploys: the CLI prints "no changes detected in watch paths,
//     build will skip" (railwayapp/cli#787).
//
// WHAT DIVERGENCE COSTS, in both directions:
//
//   OVER-DEPLOY (pattern in CI, not in Railway). The job runs, stamps GIT_SHA
//   as a service variable, uploads, and Railway skips the build. The container
//   never restarts, keeps serving the old commit, and the post-deploy smoke
//   fails on a SHA nothing ever ran. Observed 2026-08-20: `package.json` was in
//   the CI filter but not in watchPatterns, a script-only change tripped it, and
//   deployment 19:55:22Z came back status SKIPPED with an EMPTY image digest
//   while GIT_SHA already advertised the new commit.
//
//   UNDER-DEPLOY (pattern in Railway, not in CI). The job never runs, nothing is
//   uploaded, and the worker silently ships stale -- with NO gate firing,
//   because the verify step is guarded on `result == 'success'` and a job that
//   never ran cannot fail. `Dockerfile.worker` sat in exactly this state.
//
// The second is the dangerous one: the first fails loudly, the second is silent.
//
// railway.json is the SSOT because Railway is the system that actually gates the
// build. CI must follow it, never the reverse.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(import.meta.dirname, '..');

const readJson = (p: string): unknown => JSON.parse(readFileSync(join(REPO_ROOT, p), 'utf8'));

/** The SSOT: what Railway actually enforces. */
function railwayWatchPatterns(): readonly string[] {
  const config = readJson('workers/main-worker/railway.json') as {
    build?: { watchPatterns?: string[] };
  };
  return config.build?.watchPatterns ?? [];
}

/** What CI uses to decide whether the deploy job runs at all. */
function ciWorkerFilter(): readonly string[] {
  const workflow = parseYaml(
    readFileSync(join(REPO_ROOT, '.github/workflows/railway-deploy.yml'), 'utf8'),
  ) as {
    jobs: { gate: { steps: { id?: string; with?: { filters?: string } }[] } };
  };
  const detect = workflow.jobs.gate.steps.find((s) => s.id === 'detect');
  if (detect?.with?.filters === undefined) {
    throw new Error('railway-deploy.yml has no gate step with id "detect" carrying filters');
  }
  const filters = parseYaml(detect.with.filters) as Record<string, string[]>;
  return filters['worker'] ?? [];
}

describe('worker change detection is defined once', () => {
  it('finds a non-empty SSOT -- an empty list would make this vacuous', () => {
    expect(railwayWatchPatterns().length).toBeGreaterThan(0);
  });

  it('finds a non-empty CI filter', () => {
    expect(ciWorkerFilter().length).toBeGreaterThan(0);
  });

  it('CI and Railway watch EXACTLY the same paths', () => {
    // Order-insensitive: these are sets, and reordering one list is not drift.
    expect([...ciWorkerFilter()].sort()).toEqual([...railwayWatchPatterns()].sort());
  });

  it('watches the Dockerfile the worker is built from', () => {
    // The under-deploy case: editing this file must reach BOTH systems, or the
    // worker ships stale with nothing failing.
    const config = readJson('workers/main-worker/railway.json') as {
      build?: { dockerfilePath?: string };
    };
    const dockerfile = config.build?.dockerfilePath;
    expect(typeof dockerfile).toBe('string');
    expect(railwayWatchPatterns()).toContain(dockerfile);
    expect(ciWorkerFilter()).toContain(dockerfile);
  });

  it('does NOT watch root package.json', () => {
    // The over-deploy case that failed the 2026-08-20 deploy. Root package.json
    // carries scripts and tooling the worker never runs; dependency changes
    // reach it through pnpm-lock.yaml, which IS watched.
    expect(railwayWatchPatterns()).not.toContain('package.json');
    expect(ciWorkerFilter()).not.toContain('package.json');
  });

  it('watches the lockfile, which is how dependency changes reach the worker', () => {
    expect(railwayWatchPatterns()).toContain('pnpm-lock.yaml');
    expect(ciWorkerFilter()).toContain('pnpm-lock.yaml');
  });
});
