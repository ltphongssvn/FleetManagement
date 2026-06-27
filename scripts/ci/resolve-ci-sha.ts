// scripts/ci/resolve-ci-sha.ts
// Pure SHA-resolution logic for the railway-deploy.yml gate job. The
// inline 'base: HEAD~1' in YAML failed under workflow_run context with
// 'git failed exit 128' because dorny/paths-filter@v3 tried to
// merge-base HEAD~1 develop, and develop didn't exist locally in the
// shallow checkout. Per the upstream issue #201 resolution, pre-
// resolving HEAD~1 to an explicit commit SHA bypasses ref resolution
// entirely -- paths-filter then compares SHA-to-SHA.
//
// This module is INTENTIONALLY pure: no execSync, no fs, no
// process.exit. The git invocation lives in a separate main()
// entrypoint composed below, so the resolution rules can be unit-
// tested without touching the filesystem or remote.

import { z } from 'zod';
import { spawnSync } from 'node:child_process';

// 40-char lowercase hex SHA (full git sha-1). Short SHAs are not
// accepted here because GitHub Actions always provides full SHAs in
// GITHUB_SHA and workflow_run.head_sha; rejecting anything else
// catches misconfigured callers early.
const fullShaSchema = z.string().regex(/^[0-9a-f]{40}$/, 'must be 40 hex chars');

export const ciEnvSchema = z.object({
  GITHUB_EVENT_NAME: z.string().min(1, 'event name required'),
  GITHUB_SHA: fullShaSchema,
  WORKFLOW_RUN_HEAD_SHA: fullShaSchema.optional(),
});

export type CiEnv = z.infer<typeof ciEnvSchema>;

// Pick the SHA we are resolving a base FOR. For workflow_run events,
// the workflow itself runs from main's tip, but the SHA whose change-
// set we want to detect is the head_sha of the upstream run that
// triggered us (which may have moved past main's tip if a newer
// commit landed). For everything else, GITHUB_SHA is correct.
export function pickCurrentSha(env: CiEnv): string {
  if (env.GITHUB_EVENT_NAME === 'workflow_run' && env.WORKFLOW_RUN_HEAD_SHA) {
    return env.WORKFLOW_RUN_HEAD_SHA;
  }
  return env.GITHUB_SHA;
}

export type ResolveStrategy = 'parent' | 'self-fallback';

export interface ResolvedBase {
  baseSha: string;
  strategy: ResolveStrategy;
}

// Pure resolution: given a current SHA and its parent (or null/empty
// if no parent is reachable), produce the SHA to hand to paths-filter
// as 'base'. The self-fallback path means paths-filter will compare
// the current SHA to itself -> empty diff -> all service filters
// report no changes -> all deploys skip. That is the correct safe
// default for an initial commit or a shallow clone that did not
// fetch HEAD~1.
export function resolveBaseSha(currentSha: string, parentSha: string | null): ResolvedBase {
  if (parentSha === null || parentSha === '') {
    return { baseSha: currentSha, strategy: 'self-fallback' };
  }
  return { baseSha: parentSha, strategy: 'parent' };
}

// Side-effecting helper used only from main(). spawnSync is fine here
// because we never call it from the pure exports above. Returns null
// on any failure (initial commit, shallow clone without HEAD~1,
// missing git, etc.) so resolveBaseSha can pick the fallback path.
function tryGetParentSha(currentSha: string): string | null {
  const r = spawnSync('git', ['rev-parse', '--verify', currentSha + '^'], {
    encoding: 'utf-8',
  });
  if (r.status !== 0) return null;
  const out = (r.stdout || '').trim();
  return /^[0-9a-f]{40}$/.test(out) ? out : null;
}

// CLI entrypoint: read env, resolve, emit ONLY the base SHA to stdout
// (logs go to stderr) so a GitHub Actions step can capture it via
// BASE_SHA=$(pnpm exec tsx scripts/ci/resolve-ci-sha.ts).
function main(): void {
  const parsed = ciEnvSchema.safeParse({
    GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME,
    GITHUB_SHA: process.env.GITHUB_SHA,
    WORKFLOW_RUN_HEAD_SHA: process.env.WORKFLOW_RUN_HEAD_SHA,
  });
  if (!parsed.success) {
    console.error('resolve-ci-sha: invalid env: ' + JSON.stringify(parsed.error.issues));
    process.exit(1);
  }
  const currentSha = pickCurrentSha(parsed.data);
  const parentSha = tryGetParentSha(currentSha);
  const resolved = resolveBaseSha(currentSha, parentSha);
  console.error('resolve-ci-sha: event=' + parsed.data.GITHUB_EVENT_NAME +
    ' current=' + currentSha.slice(0, 7) +
    ' base=' + resolved.baseSha.slice(0, 7) +
    ' strategy=' + resolved.strategy);
  process.stdout.write(resolved.baseSha + '\n');
}

// Only run main() when invoked as a script, not when imported by tests.
const isDirectInvocation = process.argv[1]?.endsWith('resolve-ci-sha.ts');
if (isDirectInvocation) {
  main();
}
