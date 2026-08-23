// scripts/ci/resolve-ci-sha.ts
// Pure SHA-resolution logic for the railway-deploy.yml gate job, feeding
// dorny/paths-filter@v4 the 'base' SHA it diffs 'current' against.
//
// Original bug: inline 'base: HEAD~1' under workflow_run context exit-128'd
// (paths-filter merge-based HEAD~1 against develop, absent from the shallow
// clone). Fixed by pre-resolving to a real commit SHA in this pure, unit-
// tested module -- paths-filter then compares SHA-to-SHA.
//
// 2026 revision -- dependency-aware base: the parent (HEAD~1) base is a ONE-
// COMMIT diff window. If an app change landed a promote-cycle back, or was
// separated from the deploy trigger by an intervening CI-infra commit, the
// parent..current diff does not contain it, paths-filter reports the service
// unchanged, and a stale image ships (the ops-web under-build we hit). The base
// is now the last SUCCESSFULLY-DEPLOYED SHA when one is known: diffing
// last-deployed..current is the COMPLETE change set since that service last
// shipped -- immune to intervening commits, and (unlike Turborepo --affected
// --base=origin/main) it needs no full git history, so the gate keeps its
// shallow fetch-depth. Precedence: last-deployed (known and != current) ->
// parent -> self-fallback.
//
// The pure exports below are INTENTIONALLY free of I/O: no spawnSync, no fetch,
// no process.exit. The git call and the GitHub API call live in side-effecting
// helpers used only by main(), so the resolution rules stay unit-testable.
//
// ENV READS USE BRACKET NOTATION (2026-08-08). process.env is typed as an index
// signature, so dot access is TS4111 under noPropertyAccessFromIndexSignature.
// Bracket notation is the sanctioned form, not a workaround: the flag exists to
// keep the access syntax consistent with how the property is declared, and
// without it TypeScript silently accepts reads of variables that are not
// defined -- a typo'd env name would resolve to undefined and take the graceful
// skip path below, hiding a misconfigured workflow. typescript-eslint's
// dot-notation rule explicitly permits bracket access when this flag is on, so
// the two tools agree. Disabling the flag (the commonly-suggested "fix") would
// clear the error by deleting the check.

import { z } from 'zod';
import { spawnSync } from 'node:child_process';

const fullShaSchema = z.string().regex(/^[0-9a-f]{40}$/, 'must be 40 hex chars');

export const ciEnvSchema = z.object({
  GITHUB_EVENT_NAME: z.string().min(1, 'event name required'),
  GITHUB_SHA: fullShaSchema,
  // GitHub Actions yields an EMPTY STRING (not undefined) for
  // \${{ github.event.workflow_run.head_sha }} on non-workflow_run events.
  // Normalize '' -> undefined so dispatch and workflow_run both parse; then
  // pickCurrentSha falls back to GITHUB_SHA when the value is absent.
  WORKFLOW_RUN_HEAD_SHA: z.preprocess((v) => (v === '' ? undefined : v), fullShaSchema.optional()),
});

export type CiEnv = z.infer<typeof ciEnvSchema>;

// Pick the SHA we are resolving a base FOR. For workflow_run events the SHA of
// interest is the head_sha of the upstream run that triggered us (which may
// have moved past main's tip); for everything else GITHUB_SHA is correct.
export function pickCurrentSha(env: CiEnv): string {
  if (env.GITHUB_EVENT_NAME === 'workflow_run' && env.WORKFLOW_RUN_HEAD_SHA) {
    return env.WORKFLOW_RUN_HEAD_SHA;
  }
  return env.GITHUB_SHA;
}

export type ResolveStrategy = 'last-deployed' | 'parent' | 'self-fallback';

export interface ResolvedBase {
  baseSha: string;
  strategy: ResolveStrategy;
}

// Pure resolution. Precedence:
//   1. last-deployed -- when a prior successful deploy SHA is known AND differs
//      from current. Diffing last-deployed..current is the complete change
//      window since the service last shipped; this is the fix for the one-
//      commit-window under-build.
//   2. parent -- the previous behavior, used when there is no usable last-
//      deployed SHA (no prior deploy, or the last deploy WAS this commit, e.g.
//      a re-run/no-op redeploy where current..current would skip everything).
//   3. self-fallback -- neither a last-deployed nor a parent SHA is available
//      (initial commit, or a clone too shallow to resolve HEAD~1). paths-filter
//      then compares current to itself -> empty diff -> all services skip, the
//      safe default.
// Empty strings are treated as absent for both optional inputs.
export function resolveBaseSha(
  currentSha: string,
  parentSha: string | null,
  lastDeployedSha: string | null = null,
): ResolvedBase {
  const deployed = lastDeployedSha === '' ? null : lastDeployedSha;
  if (deployed !== null && deployed !== currentSha) {
    return { baseSha: deployed, strategy: 'last-deployed' };
  }
  const parent = parentSha === '' ? null : parentSha;
  if (parent !== null) {
    return { baseSha: parent, strategy: 'parent' };
  }
  return { baseSha: currentSha, strategy: 'self-fallback' };
}

// Side-effecting: resolve the current SHA's parent. Returns null on any failure
// (initial commit, shallow clone without HEAD~1, missing git) so resolveBaseSha
// can pick a fallback. Used only from main().
function tryGetParentSha(currentSha: string): string | null {
  const r = spawnSync('git', ['rev-parse', '--verify', currentSha + '^'], {
    encoding: 'utf-8',
  });
  if (r.status !== 0) return null;
  const out = (r.stdout || '').trim();
  return /^[0-9a-f]{40}$/.test(out) ? out : null;
}

// Side-effecting: find the head_sha of the most recent SUCCESSFUL run of this
// same deploy workflow, EXCLUDING the current run (so a re-run does not resolve
// to itself). Queries the GitHub REST API with the Actions-provided token.
// Returns null on any failure (no token, API error, no prior successful run,
// malformed payload) so resolveBaseSha falls back to the parent window. Used
// only from main().
//
// Env inputs (all provided by the Actions runtime):
//   GITHUB_API_URL       e.g. https://api.github.com
//   GITHUB_REPOSITORY    owner/repo
//   GITHUB_TOKEN         the job token (needs actions:read)
//   GITHUB_RUN_ID        the current run, excluded from the search
//   DEPLOY_WORKFLOW_FILE the workflow file name to scope the query
//
// These stay raw reads with a guard rather than a Zod schema on purpose: every
// one is OPTIONAL, and their absence is a supported state that degrades to the
// parent window. ciEnvSchema validates the inputs main() REQUIRES.
function tryGetLastDeployedSha(currentSha: string): string | null {
  const apiUrl = process.env['GITHUB_API_URL'];
  const repo = process.env['GITHUB_REPOSITORY'];
  const token = process.env['GITHUB_TOKEN'];
  const runId = process.env['GITHUB_RUN_ID'];
  const workflowFile = process.env['DEPLOY_WORKFLOW_FILE'];
  if (!apiUrl || !repo || !token || !workflowFile) {
    console.error(
      'resolve-ci-sha: last-deployed lookup skipped (missing api/repo/token/workflow env)',
    );
    return null;
  }
  // Ask for successful runs of just this workflow, newest first. curl keeps the
  // module dependency-free (no octokit); spawnSync stays off the pure exports.
  const endpoint =
    apiUrl +
    '/repos/' +
    repo +
    '/actions/workflows/' +
    encodeURIComponent(workflowFile) +
    '/runs?status=success&per_page=20';
  const r = spawnSync(
    'curl',
    [
      '--silent',
      '--show-error',
      '--fail',
      '-H',
      'Accept: application/vnd.github+json',
      '-H',
      'Authorization: Bearer ' + token,
      '-H',
      'X-GitHub-Api-Version: 2022-11-28',
      endpoint,
    ],
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    console.error('resolve-ci-sha: last-deployed API call failed: ' + (r.stderr || '').trim());
    return null;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(r.stdout || '');
  } catch {
    console.error('resolve-ci-sha: last-deployed payload was not JSON');
    return null;
  }
  const runsSchema = z.object({
    workflow_runs: z.array(
      z.object({
        id: z.number(),
        head_sha: z.string(),
        conclusion: z.string().nullable(),
      }),
    ),
  });
  const parsed = runsSchema.safeParse(payload);
  if (!parsed.success) {
    console.error('resolve-ci-sha: last-deployed payload shape unexpected');
    return null;
  }
  const currentRunId = runId ? Number(runId) : NaN;
  for (const run of parsed.data.workflow_runs) {
    if (run.conclusion !== 'success') continue;
    if (!Number.isNaN(currentRunId) && run.id === currentRunId) continue;
    if (run.head_sha === currentSha) continue;
    if (/^[0-9a-f]{40}$/.test(run.head_sha)) return run.head_sha;
  }
  console.error('resolve-ci-sha: no prior successful deploy run found');
  return null;
}

// CLI entrypoint: read env, resolve, emit ONLY the base SHA to stdout (logs to
// stderr) so a GitHub Actions step can capture it via
// BASE_SHA=\$(pnpm run --silent ci:resolve-sha).
function main(): void {
  const parsed = ciEnvSchema.safeParse({
    GITHUB_EVENT_NAME: process.env['GITHUB_EVENT_NAME'],
    GITHUB_SHA: process.env['GITHUB_SHA'],
    WORKFLOW_RUN_HEAD_SHA: process.env['WORKFLOW_RUN_HEAD_SHA'],
  });
  if (!parsed.success) {
    console.error('resolve-ci-sha: invalid env: ' + JSON.stringify(parsed.error.issues));
    process.exit(1);
  }
  const currentSha = pickCurrentSha(parsed.data);
  const lastDeployedSha = tryGetLastDeployedSha(currentSha);
  const parentSha = tryGetParentSha(currentSha);
  const resolved = resolveBaseSha(currentSha, parentSha, lastDeployedSha);
  console.error(
    'resolve-ci-sha: event=' +
      parsed.data.GITHUB_EVENT_NAME +
      ' current=' +
      currentSha.slice(0, 7) +
      ' lastDeployed=' +
      (lastDeployedSha ? lastDeployedSha.slice(0, 7) : 'none') +
      ' parent=' +
      (parentSha ? parentSha.slice(0, 7) : 'none') +
      ' base=' +
      resolved.baseSha.slice(0, 7) +
      ' strategy=' +
      resolved.strategy,
  );
  process.stdout.write(resolved.baseSha + '\n');
}

const isDirectInvocation = process.argv[1]?.endsWith('resolve-ci-sha.ts');
if (isDirectInvocation) {
  main();
}
