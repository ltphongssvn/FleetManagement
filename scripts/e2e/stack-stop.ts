// scripts/e2e/stack-stop.ts
// Data-safe teardown of every running fleet compose stack.
//
// STANDING RULE: never leave a fleet stack idle holding resident RAM -- stop it
// after use. This task exists to enforce that and, until now, could not.
//
// THE BUG THIS FIXES: composeProject was pinned to 'fleet-pilot', matching the
// identity stack-up.ts hardcoded at the time. compose-identity.ts later began
// injecting a per-worktree project (fleet-<key>) into each worktree's .env, so
// this planned `docker compose -p fleet-pilot stop` against a project that was
// not running. Stopping an empty project is not an error, so spawnSync returned
// 0, the task printed STACK STOPPED, and exited 0 -- while seven containers
// from a stack:up two days earlier stayed resident the entire time. The
// hardcoded default is DELETED rather than corrected: a fixed identity in this
// API surface is the defect itself.
//
// Discovery is delegated to docker-reclaim.ts, which reads project names from
// `docker compose ls --format json` (compose reports its own names; container
// names are never parsed -- hyphenated services like ops-web and mock-oauth2
// break every split, and a fleet-<hex> pattern silently skips fleet-pilot).
// One source of truth for WHICH projects exist, consumed by both tasks.
//
// SCOPE: deliberately `stop`, never `down`/-v -- containers halt and release
// memory while named volumes, networks and container state survive for an
// instant restart. Deliberately no cache pruning either: that is
// //#docker:reclaim's job, and the two tasks stay distinct so the light "I'm
// done for now" op cannot quietly delete build cache.
//
// FAILS CLOSED. The verdict comes from re-reading the projects AFTER stopping,
// never from the stop commands' exit codes, and an unreadable daemon throws
// rather than parsing to an empty list -- because "nothing is running" is
// exactly what a broken read looks like.
//
// Pure planners (stopComposeArgs, stackStopVerdict) are unit-tested under
// //#test:scripts; only main() touches docker, and it runs ONLY as entrypoint.
import { spawnSync } from 'node:child_process';
import { fleetProjectsFrom } from './docker-reclaim.js';

// A compose project raised by this repo: 'fleet-' plus the 12-hex worktree key
// (compose-identity.ts composeProject), or the legacy shared 'fleet-pilot'.
// Discovery already filters to the fleet- prefix; this is the fail-fast for a
// value that could not be one of ours, which would stop nothing and look green.
const FLEET_PROJECT = /^fleet-(pilot|[0-9a-f]{12})$/;

/** Data-safe stop argv for ONE discovered project. Throws on a foreign name. */
export function stopComposeArgs(project: string): readonly string[] {
  if (!FLEET_PROJECT.test(project)) {
    throw new Error('refusing to stop a non-fleet compose project: ' + JSON.stringify(project));
  }
  return ['compose', '-p', project, 'stop'];
}

export interface StackStopVerdict {
  readonly verdict: 'STOPPED' | 'INCOMPLETE';
  readonly survivors: readonly string[];
  readonly exitCode: number;
}

/** Post-condition verdict: survivors are read AFTER stopping, and fail the task. */
export function stackStopVerdict(survivors: readonly string[]): StackStopVerdict {
  return survivors.length === 0
    ? { verdict: 'STOPPED', survivors: [], exitCode: 0 }
    : { verdict: 'INCOMPLETE', survivors: [...survivors], exitCode: 1 };
}

/* v8 ignore start -- side-effecting driver; the planners above are unit-tested */
const NL = String.fromCharCode(10);

function runningFleetProjects(): readonly string[] {
  const r = spawnSync('docker', ['compose', 'ls', '--format', 'json'], { encoding: 'utf-8' });
  if (r.status !== 0) {
    throw new Error('docker compose ls failed: ' + r.stderr);
  }
  return fleetProjectsFrom(r.stdout);
}

function main(): number {
  const projects = runningFleetProjects();
  if (projects.length === 0) {
    process.stderr.write('[stack:stop] no fleet projects running' + NL);
  }
  for (const project of projects) {
    process.stderr.write(
      '[stack:stop] stopping ' + project + ' (data-safe; volumes + state retained)' + NL,
    );
    spawnSync('docker', [...stopComposeArgs(project)], { stdio: 'inherit' });
  }

  const v = stackStopVerdict(runningFleetProjects());
  if (v.verdict === 'STOPPED') {
    process.stderr.write(
      '[stack:stop] STOPPED -- restart on demand: pnpm run stack:restart (or stack:up)' + NL,
    );
  } else {
    process.stderr.write(
      '[stack:stop] INCOMPLETE -- still running: ' + v.survivors.join(', ') + NL,
    );
  }
  return v.exitCode;
}

const isMain = process.argv[1] !== undefined && import.meta.url === 'file://' + process.argv[1];
if (isMain) {
  try {
    process.exit(main());
  } catch (e) {
    process.stderr.write(
      '[stack:stop] CANNOT VERIFY -- ' +
        (e instanceof Error ? e.message : String(e)) +
        NL +
        'The Docker daemon is unreachable, so no claim about idle stacks can be made.' +
        NL,
    );
    process.exit(1);
  }
}
/* v8 ignore stop */
