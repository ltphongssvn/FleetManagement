// scripts/e2e/stack-e2e-isolated.ts
// Committed, rediscoverable ISOLATED browser-E2E runner. Composes the existing
// per-worktree compose identity (compose-identity.ts identityFor) into ONE
// reproducible op: raise the app-only stack (infra + api + ops-web, NO driver/
// expo/android) on this worktree deterministic ports, run Playwright against
// them via the existing ops-web-runner readiness gate, then tear the stack down.
// Replaces the ad-hoc docker compose + inline E2E_* env pattern (which is not
// rediscoverable and drifts). 2026 practice: per-worktree runtime isolation
// policy above git worktrees (COMPOSE_PROJECT_NAME + deterministic port block),
// health-gated compose up --wait, app-only service scope for a sub-5-min suite.
//
// Pure planners (e2eEnvFromIdentity / browserE2EServices / browserE2EReadiness)
// are unit-tested; the side-effecting main() runs ONLY as entrypoint so the
// contract test imports the pure parts without spawning docker/playwright.
import { spawnSync } from 'node:child_process';
import { identityFor, type ComposeIdentity } from '../compose-identity.ts';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveGateLockPath, buildFlockArgs } from '../host-gate.ts';

export interface E2EEnv {
  readonly E2E_BASE_URL: string;
  readonly E2E_API_URL: string;
  // The mock IdP authorize endpoint THIS stack redirects to. ops-web-login.spec
  // asserts startLogin redirects to the configured authorize URL; without this
  // the spec falls back to the playwright.config placeholder
  // (https://kc.e2e.example/...) while the isolated stack actually redirects to
  // its own mock-oauth2 on the identity OAUTH port -> guaranteed mismatch.
  // e2e.yml sets the same variable for the shared-stack CI run; deriving it from
  // the identity is the isolated-stack equivalent.
  readonly OIDC_AUTHORIZATION_ENDPOINT: string;
}

// Derive the Playwright base/api URLs from the worktree identity ports. Browser
// E2E runs against the LOCAL isolated stack, so both are localhost:<port>.
export function e2eEnvFromIdentity(id: ComposeIdentity): E2EEnv {
  return {
    E2E_BASE_URL: 'http://localhost:' + String(id.ports.OPS_WEB),
    E2E_API_URL: 'http://localhost:' + String(id.ports.API),
    OIDC_AUTHORIZATION_ENDPOINT: 'http://localhost:' + String(id.ports.OAUTH) + '/fleet/authorize',
  };
}

// App-only compose services in dependency-safe order (infra healthchecked before
// api; ops-web last). Deliberately EXCLUDES driver-app / expo / android: browser
// E2E exercises ops-web + api only, and an emulator boot is neither needed nor
// wanted here (that is stack-up.ts full-fleet territory).
export function browserE2EServices(): readonly string[] {
  return ['postgres', 'redis', 'mock-oauth2', 'localstack', 'api', 'ops-web'];
}

// Readiness targets the runner waits on before Playwright: api /health/ready
// (200 = db up) + the ops-web base (serving). Same contract ops-web-runner polls.
export function browserE2EReadiness(id: ComposeIdentity): readonly string[] {
  const env = e2eEnvFromIdentity(id);
  return [env.E2E_API_URL + '/health/ready', env.E2E_BASE_URL];
}

// ---- host-lock enrollment (pure planners) ----
//
// gate:integration has queued behind a host-wide flock since fab24dd, and
// 742e1f7 unified it with the pre-push coverage hook on one inode. This
// runner was never enrolled, yet it is the heaviest consumer on the host:
// seven containers plus a --no-cache rebuild of two app images. The two
// guarded gates queued for each other while the biggest one barged through,
// so a sibling worktree could still starve a run that had done everything
// right. Sharing the SAME resolver guarantees the same inode -- a second
// path would silently mean no exclusion at all.
//
// flock(1) holds the lock for the lifetime of a CHILD process, so a script
// cannot wrap its own already-running body. It re-executes ITSELF under
// flock instead; this sentinel stops that recursing forever.
export const HOST_LOCK_ENV = 'FLEET_HOST_LOCK_HELD';

// Queue budget. Matches gate:integration: long enough to outlast a genuine
// sibling run, short enough that a wedged host fails loudly overnight
// instead of hanging in silence.
// One isolated E2E stack runs about 25 minutes (seven containers plus a
// --no-cache rebuild of two app images), so several legitimately queued
// siblings exceed an hour with nothing wrong. gate:integration budget of
// 3600s was sized for a minutes-long gate and timed this runner out live
// after waiting behind a single sibling. Four sibling runs is the budget.
export const HOST_LOCK_WAIT_SECONDS = 4 * 25 * 60;

export function shouldTakeHostLock(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[HOST_LOCK_ENV] !== '1';
}

// Rebuild THIS invocation verbatim under flock: the interpreter and script
// path from execArgv, plus the caller spec arguments. Losing the arguments
// here would silently widen a targeted run into the whole suite.
// flock(1) exits 1 on -w timeout and writes NOTHING, so a queued-out run is
// indistinguishable from a failing suite. Observed live: a sibling gate held
// the lock, this runner waited the whole budget and died silent after an
// hour. host-gate exists to replace uninterpretable runs with actionable
// ones, so the timeout has to name itself.
export function isLockTimeoutExit(code: number, lockWasTaken: boolean): boolean {
  return lockWasTaken && code === 1;
}

export function hostLockTimeoutMessage(lockPath: string, waitSeconds: number): string {
  return (
    '[isolated-e2e] timed out after ' +
    String(waitSeconds) +
    's waiting for the host lock ' +
    lockPath +
    '.' +
    String.fromCharCode(10) +
    'A sibling worktree still holds it. This is a HOST condition, not a test' +
    ' failure: nothing in this branch is broken.' +
    String.fromCharCode(10) +
    'Inspect the holder with: lslocks | grep gate.lock' +
    String.fromCharCode(10)
  );
}

export function selfUnderLockCommand(
  lockPath: string,
  argv0: readonly string[],
  passthrough: readonly string[],
): readonly string[] {
  const inner = [...argv0, ...passthrough];
  return ['flock', ...buildFlockArgs(lockPath, HOST_LOCK_WAIT_SECONDS, inner)];
}

// ---- side-effecting entrypoint (never imported by the contract test) ----
function sh(cmd: string, args: readonly string[], env?: NodeJS.ProcessEnv): number {
  const r = spawnSync(cmd, [...args], { stdio: 'inherit', env: env ?? process.env });
  return r.status ?? 1;
}

function composeArgs(project: string, rest: readonly string[]): readonly string[] {
  return ['compose', '-p', project, ...rest];
}

function mainIsolatedE2E(): number {
  // Take the host lock BEFORE any docker work, by re-executing under flock.
  // The lock dir is created first: flock OPENS the file and will not create
  // missing parents (the da1257f fix, same reasoning).
  if (shouldTakeHostLock(process.env)) {
    const lockPath = resolveGateLockPath(process.env, homedir());
    mkdirSync(dirname(lockPath), { recursive: true });
    // Re-enter through pnpm exec tsx, NOT process.execPath: this runner is a
    // TypeScript file and bare node cannot load it. The same invocation form
    // this script already uses for compose-identity and ops-web-runner.
    const cmd = selfUnderLockCommand(
      lockPath,
      ['pnpm', 'exec', 'tsx', 'scripts/e2e/stack-e2e-isolated.ts'],
      process.argv.slice(2),
    );
    process.stderr.write(
      '[isolated-e2e] acquiring host lock ' +
        lockPath +
        ' (queueing up to ' +
        String(HOST_LOCK_WAIT_SECONDS) +
        's)' +
        String.fromCharCode(10),
    );
    const head = cmd[0] ?? 'flock';
    const code = sh(head, cmd.slice(1), { ...process.env, [HOST_LOCK_ENV]: '1' });
    if (isLockTimeoutExit(code, true)) {
      process.stderr.write(hostLockTimeoutMessage(lockPath, HOST_LOCK_WAIT_SECONDS));
    }
    return code;
  }

  const id = identityFor(process.cwd());
  // Ensure THIS worktree compose identity (FLEET_COMPOSE_PROJECT + FLEET_PORT_*
  // block) is written into .env BEFORE docker compose up, so the stack publishes
  // on the identity ports the runner then targets. Without this the api service
  // falls back to compose defaults (3000/3001) while the runner polls the identity
  // ports -> healthy container, host-unreachable port -> readiness timeout.
  const injectCode = sh('pnpm', ['exec', 'tsx', 'scripts/compose-identity.ts', '--env', '.env']);
  if (injectCode !== 0) return injectCode;
  const services = browserE2EServices();
  const built = services.filter((s) => s === 'api' || s === 'ops-web');
  const passthrough = process.argv.slice(2);
  // Fresh-SOURCE build: --no-cache recompiles app source every run (stale dist has
  // shipped false greens), but we DO NOT builder-prune -- that wipes the pnpm store
  // cache-mount (--mount=type=cache,id=pnpm), forcing a full ~1800-package re-download
  // that times out under WSL2/registry contention. Dependencies are lockfile-pinned
  // (reproducible), so reusing the cached pnpm store is safe AND correct; only the
  // source layers are rebuilt. up --wait is health-gated; --force-recreate is fresh.
  process.stderr.write(
    '[isolated-e2e] project ' +
      id.project +
      ' -- build --no-cache (pnpm store cache-mount preserved)' +
      String.fromCharCode(10),
  );
  let code = sh('docker', composeArgs(id.project, ['build', '--no-cache', ...built]));
  if (code !== 0) return code;
  process.stderr.write('[isolated-e2e] up -d --wait --force-recreate' + String.fromCharCode(10));
  code = sh(
    'docker',
    composeArgs(id.project, ['up', '-d', '--wait', '--force-recreate', ...services]),
  );
  if (code !== 0) {
    sh('docker', composeArgs(id.project, ['down', '-v']));
    return code;
  }
  // Run Playwright via the existing ops-web-runner (readiness gate + reporter
  // SSOT), with the identity-derived E2E_* in the child env. Passthrough spec
  // args flow through to Playwright.
  const e2eEnv = e2eEnvFromIdentity(id);
  // E2E_API_CONTAINER: the isolated project api container (auth.ts dockerExecs
  // into it to mint the mock-IdP token); derived from the identity project so it
  // targets THIS worktree stack, not the default fleet-pilot-api-1.
  // E2E_OPS_PASSWORD: required by ops-web-runner schema but unused by the token-
  // based auth path (auth.ts mints from the mock IdP, no password), so any non-
  // empty value satisfies the over-strict boundary schema.
  const childEnv = {
    ...process.env,
    E2E_BASE_URL: e2eEnv.E2E_BASE_URL,
    E2E_API_URL: e2eEnv.E2E_API_URL,
    E2E_API_CONTAINER: id.project + '-api-1',
    // E2E_PG_CONTAINER: the isolated project postgres container. The Playwright
    // global-teardown (via docker-exec.ts dockerPsql) already reads this env with
    // a fleet-pilot-postgres-1 fallback; setting it from the identity scopes the
    // teardown docker exec to THIS worktree postgres, so it can never touch a
    // parallel worktree container (which the hardcoded fallback would).
    E2E_PG_CONTAINER: id.project + '-postgres-1',
    // OIDC_AUTHORIZATION_ENDPOINT: the login spec reads this from its own process
    // env to know where startLogin must redirect. Unset, playwright.config falls
    // back to the kc.e2e.example placeholder while this stack redirects to its own
    // mock-oauth2 -> the spec fails on a config mismatch, not a product defect.
    OIDC_AUTHORIZATION_ENDPOINT: e2eEnv.OIDC_AUTHORIZATION_ENDPOINT,
    E2E_OPS_PASSWORD: process.env['E2E_OPS_PASSWORD'] ?? 'unused-token-auth',
  };
  process.stderr.write(
    '[isolated-e2e] ops-web-runner @ ' +
      e2eEnv.E2E_BASE_URL +
      ' (api ' +
      e2eEnv.E2E_API_URL +
      ')' +
      String.fromCharCode(10),
  );
  const testCode = sh(
    'pnpm',
    ['exec', 'tsx', 'scripts/e2e/ops-web-runner.ts', ...passthrough],
    childEnv,
  );
  // Always tear the stack down (data-safe: -v drops the isolated volumes).
  process.stderr.write('[isolated-e2e] down -v' + String.fromCharCode(10));
  sh('docker', composeArgs(id.project, ['down', '-v']));
  return testCode;
}

/* v8 ignore start -- side-effecting entrypoint; pure planners above are unit-tested */
const isMain = process.argv[1]?.endsWith('stack-e2e-isolated.ts') ?? false;
if (isMain) {
  process.exit(mainIsolatedE2E());
}
/* v8 ignore stop */
