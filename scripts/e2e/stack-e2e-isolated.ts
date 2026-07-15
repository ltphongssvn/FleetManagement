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

export interface E2EEnv {
  readonly E2E_BASE_URL: string;
  readonly E2E_API_URL: string;
}

// Derive the Playwright base/api URLs from the worktree identity ports. Browser
// E2E runs against the LOCAL isolated stack, so both are localhost:<port>.
export function e2eEnvFromIdentity(id: ComposeIdentity): E2EEnv {
  return {
    E2E_BASE_URL: 'http://localhost:' + String(id.ports.OPS_WEB),
    E2E_API_URL: 'http://localhost:' + String(id.ports.API),
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

// ---- side-effecting entrypoint (never imported by the contract test) ----
function sh(cmd: string, args: readonly string[], env?: NodeJS.ProcessEnv): number {
  const r = spawnSync(cmd, [...args], { stdio: 'inherit', env: env ?? process.env });
  return r.status ?? 1;
}

function composeArgs(project: string, rest: readonly string[]): readonly string[] {
  return ['compose', '-p', project, ...rest];
}

function mainIsolatedE2E(): number {
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
  process.stderr.write('[isolated-e2e] project ' + id.project + ' -- build --no-cache (pnpm store cache-mount preserved)' + String.fromCharCode(10));
  let code = sh('docker', composeArgs(id.project, ['build', '--no-cache', ...built]));
  if (code !== 0) return code;
  process.stderr.write('[isolated-e2e] up -d --wait --force-recreate' + String.fromCharCode(10));
  code = sh('docker', composeArgs(id.project, ['up', '-d', '--wait', '--force-recreate', ...services]));
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
    E2E_OPS_PASSWORD: process.env.E2E_OPS_PASSWORD ?? 'unused-token-auth',
  };
  process.stderr.write('[isolated-e2e] ops-web-runner @ ' + e2eEnv.E2E_BASE_URL + ' (api ' + e2eEnv.E2E_API_URL + ')' + String.fromCharCode(10));
  const testCode = sh('pnpm', ['exec', 'tsx', 'scripts/e2e/ops-web-runner.ts', ...passthrough], childEnv);
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
