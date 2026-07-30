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

// One argv per variable, using the CURRENT subcommand form. The CLI help marks
// the --set flag as legacy in favour of "variable set", and --skip-deploys is
// mandatory: without it each stamp triggers its own redeploy, which would loop
// set -> deploy -> set -> deploy. Variables are sorted so the emitted sequence
// is reproducible and diffable in CI logs.
export function railwayVariablesArgs(
  service: string,
  variables: Readonly<Record<string, string>>,
): readonly (readonly string[])[] {
  if (service.trim().length === 0) {
    throw new Error('railwayVariablesArgs: service must not be blank');
  }
  const names = Object.keys(variables).sort();
  if (names.length === 0) {
    throw new Error('railwayVariablesArgs: refusing to run with no variables');
  }
  return names.map((name) => {
    const value = variables[name] ?? '';
    if (value.includes(NEWLINE)) {
      throw new Error('railwayVariablesArgs: value for ' + name + ' contains a newline');
    }
    return [
      'variable', 'set', name + '=' + value,
      '--service', service.trim(), '--skip-deploys',
    ];
  });
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
      reason: 'live sha ' + live.slice(0, 7) +
        ' does not match deployed ' + expectedSha.slice(0, 7),
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
    for (const cmd of railwayVariablesArgs(service, vars)) {
      const shown = cmd.join(' ');
      console.error('deploy-stamp: railway ' + shown);
      const r = spawnSync('railway', cmd as string[], { stdio: 'inherit' });
      if (r.status !== 0) {
        console.error('deploy-stamp: stamping failed for ' + service);
        process.exit(1);
      }
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

  console.error('usage: deploy-stamp (--stamp --service S --sha SHA --branch B | --verify --url U --sha SHA)');
  process.exit(2);
}

const isDirectInvocation = process.argv[1]?.endsWith('deploy-stamp.ts');
if (isDirectInvocation) {
  void runMain();
}

/* v8 ignore stop */
