// scripts/ci/deploy-stamp.ts
// Pure deploy-time provenance stamping. No I/O, so every rule is unit-tested.
//
// ROOT CAUSE THIS ELIMINATES
// railway-deploy.yml requires all three services to run in CLI-ONLY mode
// (Settings > Source connected to nothing) so Railway does not double-deploy
// alongside the GitHub Actions pipeline. Railway auto-injects
// RAILWAY_GIT_COMMIT_SHA only for deploys triggered from a CONNECTED repo, so
// in CLI-only mode those variables can NEVER arrive. Dockerfile.api declared
// ARG RAILWAY_GIT_COMMIT_SHA and set ENV GIT_SHA from it; Docker substitutes an
// unpassed ARG with the empty string, so the image shipped a blank GIT_SHA and
// /health/version answered unknown in production indefinitely. Deploy
// verification was consequently a manual ritual that could never succeed.
//
// The workflow already knows the exact deployed commit: the gate job resolves
// it and exposes gate.outputs.head_sha. Stamping that value as a Railway
// service variable before each railway up is the only path that survives
// CLI-only mode, and asserting it back from /health/version turns deploy
// verification into an automated gate -- 2026 practice is that provenance is
// stamped by the builder and verified in CI, never confirmed by a human.
//
// ---- ONE CALL, NOT ONE PER VARIABLE (2026-08-19) ----
//
// THE OBSERVED FAILURE. PR #618's deploy failed at the stamping step:
//   deploy-stamp: railway variable set BUILD_TIME=... --service ops-web
//   Set variables BUILD_TIME
//   deploy-stamp: railway variable set GIT_BRANCH=main --service ops-web
//   Failed to fetch: error decoding response body
//   Caused by: 1: expected value at line 1 column 1
// The FIRST variable set succeeded and the SECOND, issued immediately after,
// failed. Everything before it in the pipeline was green.
//
// THAT MESSAGE IS NOT A DECODE BUG, it is a RATE LIMIT wearing a decode bug's
// clothes. The Railway CLI JSON-parses every response body, so a non-JSON reply
// -- an HTML error page, or a 429 -- surfaces as a serde failure at line 1
// column 1 rather than as the status that caused it. Railway's own maintainers
// name it in exactly those terms on their support station: "odd that the cli is
// trying to decode that then ... if the status code is 429, just print a simple
// error that says the user [is rate limited]". The same message is reported for
// railway login and railway logs, always under rapid or repeated calls.
//
// So the defect in OUR code is the call SHAPE. This emitted ONE CLI invocation
// per variable -- three per service, nine across api, worker and ops-web, in a
// tight loop with no pause. The fix is not a retry with backoff: retrying into
// a rate limit is the treadmill, and it makes a deploy slower and still
// flaky. The fix is to stop making N calls where ONE will do.
//
// `railway variables` accepts REPEATED --set pairs and applies them in a single
// request, so all three provenance variables are stamped in one round-trip.
// Three sequential calls become one, per service, and the exposure disappears
// by construction rather than being survived.
//
// --set IS NOT LEGACY HERE, and an earlier revision of this file asserted it
// was. The legacy form is `railway variables set K=V` as a SUBCOMMAND; --set is
// the current flag on `railway variables`, and it is the only form that accepts
// several pairs at once. A test previously pinned "never emits --set", encoding
// a misreading of the CLI help as a contract -- and that assertion would have
// blocked this fix.
//
// --skip-deploys stays mandatory: without it each stamp triggers its own
// redeploy, looping set -> deploy -> set -> deploy.

const SHA_RE = /^[0-9a-f]{40}$/;
const NEWLINE = String.fromCharCode(10);

export interface StampVariables {
  readonly GIT_SHA: string;
  readonly GIT_BRANCH: string;
  readonly BUILD_TIME: string;
}

// Fails CLOSED on a blank or malformed sha. Stamping an empty value would
// recreate the exact defect this module exists to remove, and a wrong-but-
// present sha is worse than a loud failure because it would make the
// verification gate pass against the wrong commit.
export function buildStampVariables(
  sha: string,
  branch: string,
  buildTime: string,
): StampVariables {
  if (!SHA_RE.test(sha)) {
    throw new Error('buildStampVariables: sha must be 40 lowercase hex chars');
  }
  if (branch.trim().length === 0) {
    throw new Error('buildStampVariables: branch must not be blank');
  }
  if (buildTime.trim().length === 0) {
    throw new Error('buildStampVariables: buildTime must not be blank');
  }
  return { GIT_SHA: sha, GIT_BRANCH: branch.trim(), BUILD_TIME: buildTime.trim() };
}

/** ONE argv that stamps EVERY variable in a single API round-trip.
 *
 *  Returns a single command rather than a list, and that is the fix: N calls in
 *  a tight loop is what tripped Railway's rate limiter, which the CLI reports
 *  as "error decoding response body" because it JSON-parses a non-JSON body.
 *
 *  Pairs are SORTED so the emitted command is reproducible and diffable in CI
 *  logs -- the ordering is not semantic, and an unstable one makes two
 *  identical deploys look different. */
export function railwayVariablesArgs(
  service: string,
  variables: Readonly<Record<string, string>>,
): readonly string[] {
  if (service.trim().length === 0) {
    throw new Error('railwayVariablesArgs: service must not be blank');
  }
  const names = Object.keys(variables).sort();
  if (names.length === 0) {
    throw new Error('railwayVariablesArgs: refusing to run with no variables');
  }
  const pairs: string[] = [];
  for (const name of names) {
    const value = variables[name] ?? '';
    if (value.includes(NEWLINE)) {
      throw new Error('railwayVariablesArgs: value for ' + name + ' contains a newline');
    }
    pairs.push('--set', name + '=' + value);
  }
  return ['variables', ...pairs, '--service', service.trim(), '--skip-deploys'];
}

export interface ShaVerdict {
  readonly ok: boolean;
  readonly reason: string;
}

// Compare what production REPORTS against what CI DEPLOYED. Fails closed on
// anything that is not an exact match, including the unknown sentinel -- that
// value is precisely the state that concealed the missing stamp, so it must be
// a hard failure rather than a tolerated unknown.
export function evaluateDeployedSha(payload: unknown, expectedSha: string): ShaVerdict {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, reason: 'version payload was not an object' };
  }
  const raw = (payload as Record<string, unknown>)['sha'];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, reason: 'version payload has no usable sha' };
  }
  const live = raw.trim();
  if (live === 'unknown') {
    return {
      ok: false,
      reason: 'live sha is unknown: the deploy did not stamp GIT_SHA',
    };
  }
  if (live !== expectedSha) {
    return {
      ok: false,
      reason:
        'live sha ' + live.slice(0, 7) + ' does not match deployed ' + expectedSha.slice(0, 7),
    };
  }
  return { ok: true, reason: 'live sha matches deployed ' + expectedSha.slice(0, 7) };
}

/* v8 ignore start */

// Imperative shell. Two modes, both driven by the workflow:
//   --stamp  --service <name> --sha <sha> --branch <ref>
//   --verify --url <versionUrl> --sha <sha>
// Kept out of coverage; every rule it applies lives in the pure exports above.
function flag(argv: readonly string[], name: string): string | null {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const value = argv[i + 1];
  return typeof value === 'string' ? value : null;
}

async function runMain(): Promise<void> {
  const { spawnSync } = await import('node:child_process');
  const argv = process.argv.slice(2);
  const sha = flag(argv, '--sha') ?? '';

  if (argv.includes('--stamp')) {
    const service = flag(argv, '--service') ?? '';
    const branch = flag(argv, '--branch') ?? '';
    const vars = buildStampVariables(sha, branch, new Date().toISOString());
    // Spread, not cast (2026-08-08). StampVariables is an INTERFACE with three
    // named properties, so it carries no index signature and is not assignable
    // to Readonly<Record<string, string>> (TS2345). Adding an index signature
    // would re-admit arbitrary keys; an `as` cast would silence the compiler by
    // asserting a shape the type does not have. A spread produces a real Record
    // whose values are still checked.
    const cmd = railwayVariablesArgs(service, { ...vars });
    console.error('deploy-stamp: railway ' + cmd.join(' '));
    // Copy, not cast: cmd is readonly by design and spawnSync's types demand a
    // mutable array. `cmd as string[]` laundered that away -- the aliasing hole
    // where a callee may mutate values the caller believes frozen.
    const r = spawnSync('railway', [...cmd], { stdio: 'inherit' });
    if (r.status !== 0) {
      console.error('deploy-stamp: stamping failed for ' + service);
      // A Railway rate limit surfaces here as "error decoding response body";
      // naming it means the next operator does not re-diagnose it from scratch.
      console.error('deploy-stamp: if the CLI reported a decode error, that is');
      console.error('deploy-stamp: Railway rate-limiting a non-JSON reply. This');
      console.error('deploy-stamp: now issues ONE call per service, so a repeat');
      console.error('deploy-stamp: means the limit is being hit from elsewhere.');
      process.exit(1);
    }
    console.error('deploy-stamp: stamped ' + service + ' at ' + sha.slice(0, 7));
    return;
  }

  if (argv.includes('--verify')) {
    const url = flag(argv, '--url') ?? '';
    if (url.length === 0) {
      console.error('deploy-stamp: --verify requires --url');
      process.exit(2);
    }
    let payload: unknown = null;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error('deploy-stamp: version endpoint HTTP ' + String(res.status));
        process.exit(1);
      }
      payload = await res.json();
    } catch (err) {
      console.error('deploy-stamp: version endpoint unreachable: ' + (err as Error).message);
      process.exit(1);
    }
    const verdict = evaluateDeployedSha(payload, sha);
    console.error('deploy-stamp: ' + verdict.reason);
    process.exit(verdict.ok ? 0 : 1);
  }

  console.error(
    'usage: deploy-stamp (--stamp --service S --sha SHA --branch B | --verify --url U --sha SHA)',
  );
  process.exit(2);
}

const isDirectInvocation = process.argv[1]?.endsWith('deploy-stamp.ts');
if (isDirectInvocation) {
  void runMain();
}

/* v8 ignore stop */
