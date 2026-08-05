// scripts/e2e/docker-reclaim.ts
// Reclaim host resources after local Docker use, and PROVE it.
//
// STANDING RULE: never leave a fleet stack idle holding host RAM. stack:stop
// was meant to enforce that and could not: it planned `-p fleet-pilot` while
// compose-identity.ts injects a per-worktree project (fleet-<key>), so it
// targeted a project that was not running, `docker compose stop` on an empty
// project is not an error, and it exited 0 printing STACK STOPPED. Seven
// containers from a `stack:up` two days earlier stayed resident throughout.
// Projects are therefore DISCOVERED from what is actually running.
//
// Discovery reads `docker compose ls --format json`, which reports project
// names directly. Container names are deliberately NOT parsed: two attempts
// failed, both pinned as tests. Splitting on hyphens breaks on the real
// hyphenated services (ops-web, mock-oauth2, driver-app), and matching
// fleet-<12hex> silently skips the legacy shared `fleet-pilot` stack -- the
// exact stack the never-leave-it-idle rule exists for. Compose already knows
// its own project names; asking it is both simpler and correct.
//
// The build cache is trimmed by AGE, never with -a/--all. `docker builder
// prune -af` wipes the pnpm store cache-mount (--mount=type=cache,id=pnpm)
// that stack-e2e-isolated deliberately preserves, forcing a full ~1800-package
// re-download. BuildKit GC holds that mount under a much smaller policy rule
// than the bulk layers, so a blanket prune destroys the one artifact worth
// keeping and spares the ~3GB per-run builder snapshots that are the actual
// bulk.
//
// FAILS CLOSED, twice. Unreadable docker output throws rather than parsing to
// an empty list, because "nothing is running" is exactly what a broken read
// looks like. And the verdict comes from re-reading projects AFTER acting, not
// from the stop commands' exit statuses.
//
// NOT a VM-level fix: Docker Desktop's Linux VM holds its memory for as long as
// Docker Desktop is open, whether or not a container runs, so containers are the
// only layer reachable from here. Quit Docker Desktop to return the VM's RAM.
//
// Pure planners (fleetProjectsFrom / stopArgsFor / cachePruneArgs / ageFilter /
// reclaimVerdict) are unit-tested under //#test:scripts; only main() touches
// docker, and it runs ONLY as the entrypoint (isMain).
import { z } from 'zod';
import { spawnSync } from 'node:child_process';
import {
  classifyStackAge,
  inspectStartedAtArgs,
  oldestStartedAt,
  psIdsArgsForProject,
  STACK_AGE_EXIT,
  stackAgeExitCode,
} from './stack-age.js';
import {
  formatAgeReport,
  parseReclaimArgv,
  summarizeStackAges,
} from './reclaim-mode.js';
// Axis-1 trust boundary: docker CLI output is external input, validated here
// once. Compose emits more fields than these; unknown keys are ignored rather
// than rejected so a future docker release cannot break the reclaim.
export const composeProjectSchema = z.object({
  Name: z.string().min(1),
  Status: z.string(),
});
export const composeLsSchema = z.array(composeProjectSchema);

export const dockerReclaimConfigSchema = z.object({
  pruneOlderThan: z.string().min(1),
});
export type DockerReclaimConfig = z.infer<typeof dockerReclaimConfigSchema>;

// 12h keeps the current session's layers (a rebuild within a working day still
// hits cache) while evicting the previous day's duplicates, which are the bulk.
export const defaultReclaimConfig: DockerReclaimConfig = dockerReclaimConfigSchema.parse({
  pruneOlderThan: '12h',
});

const FLEET_PREFIX = 'fleet-';

/** Fleet compose projects reported by `docker compose ls --format json`, sorted.
 *  Throws on malformed input: a failed read must never look like an idle host. */
export function fleetProjectsFrom(rawJson: string): readonly string[] {
  const parsed: unknown = JSON.parse(rawJson);
  const projects = composeLsSchema.parse(parsed);
  return projects
    .map((p) => p.Name)
    .filter((name) => name.startsWith(FLEET_PREFIX))
    .sort();
}

/** Data-safe stop for one project: containers halt, volumes + networks survive. */
export function stopArgsFor(project: string): readonly string[] {
  return ['compose', '-p', project, 'stop'];
}

/** The buildx age filter expression, so the literal lives in exactly one place. */
export function ageFilter(olderThan: string): string {
  return 'until=' + olderThan;
}

/** Age-filtered cache prune. Never -a/--all: that evicts the pnpm cachemount. */
export function cachePruneArgs(c: DockerReclaimConfig): readonly string[] {
  return ['buildx', 'prune', '--filter', ageFilter(c.pruneOlderThan), '--force'];
}

export interface ReclaimVerdict {
  readonly verdict: 'RECLAIMED' | 'INCOMPLETE';
  readonly survivors: readonly string[];
  readonly exitCode: number;
}

/** Post-condition verdict: survivors are read AFTER acting, and fail the task. */
export function reclaimVerdict(survivors: readonly string[]): ReclaimVerdict {
  return survivors.length === 0
    ? { verdict: 'RECLAIMED', survivors: [], exitCode: 0 }
    : { verdict: 'INCOMPLETE', survivors: [...survivors], exitCode: 1 };
}

/* v8 ignore start -- side-effecting driver; the planners above are unit-tested */
const NL = String.fromCharCode(10);

function runningFleetProjects(): readonly string[] {
  // encoding:'utf-8' types stdout/stderr as string, so no ?? fallback is
  // reachable here -- no-unnecessary-condition rejects one as dead code.
  const r = spawnSync('docker', ['compose', 'ls', '--format', 'json'], { encoding: 'utf-8' });
  if (r.status !== 0) {
    throw new Error('docker compose ls failed: ' + r.stderr);
  }
  return fleetProjectsFrom(r.stdout);
}

/** Oldest StartedAt across one project's containers, or null when it has none.
 *  Both reads FAIL CLOSED: a docker error throws rather than yielding null,
 *  because "no containers" and "could not ask" must never look alike -- that
 *  equivalence is what let seven containers idle unnoticed. */
function oldestStartFor(project: string): string | null {
  const ps = spawnSync('docker', [...psIdsArgsForProject(project)], { encoding: 'utf-8' });
  if (ps.status !== 0) {
    throw new Error('docker ps failed for ' + project + ': ' + ps.stderr);
  }
  const ids = ps.stdout.split(NL).map((l) => l.trim()).filter((l) => l.length > 0);
  if (ids.length === 0) return null;
  const inspect = spawnSync('docker', [...inspectStartedAtArgs(ids)], { encoding: 'utf-8' });
  if (inspect.status !== 0) {
    throw new Error('docker inspect failed for ' + project + ': ' + inspect.stderr);
  }
  return oldestStartedAt(inspect.stdout);
}

/** REPORT ONLY. Reads, classifies, prints, stops nothing. */
function reportMode(ttlHours: number): number {
  const now = new Date();
  const ages = runningFleetProjects().map((project) =>
    classifyStackAge({ project, startedAt: oldestStartFor(project), now, ttlHours }),
  );
  if (ages.length === 0) {
    process.stdout.write('[docker:reclaim] no fleet projects running' + NL);
    return STACK_AGE_EXIT.ok;
  }
  for (const line of formatAgeReport(ages)) process.stdout.write(line + NL);
  const s = summarizeStackAges(ages);
  process.stdout.write(
    NL + 'Summary: ' + String(s.fresh) + ' fresh, ' + String(s.idle) + ' idle, ' +
    String(s.stale) + ' stale  (ttl ' + String(ttlHours) + 'h, REPORT ONLY -- nothing stopped)' + NL,
  );
  return stackAgeExitCode(s);
}

function reclaimMode(): number {
  const cfg = defaultReclaimConfig;
  const projects = runningFleetProjects();

  if (projects.length === 0) {
    process.stderr.write('[docker:reclaim] no fleet projects running' + NL);
  }
  for (const project of projects) {
    process.stderr.write('[docker:reclaim] stopping ' + project + ' (data-safe)' + NL);
    spawnSync('docker', [...stopArgsFor(project)], { stdio: 'inherit' });
  }

  process.stderr.write(
    '[docker:reclaim] trimming build cache older than ' + cfg.pruneOlderThan +
    ' (pnpm store cache-mount preserved)' + NL,
  );
  spawnSync('docker', [...cachePruneArgs(cfg)], { stdio: 'inherit' });

  // Re-read reality. The stop commands' exit codes are NOT the evidence.
  const v = reclaimVerdict(runningFleetProjects());
  if (v.verdict === 'RECLAIMED') {
    process.stderr.write(
      '[docker:reclaim] RECLAIMED -- no fleet projects running.' + NL +
      'Docker Desktop still holds its VM memory while open; quit it to return that RAM.' + NL,
    );
  } else {
    process.stderr.write(
      '[docker:reclaim] INCOMPLETE -- still running: ' + v.survivors.join(', ') + NL,
    );
  }
  return v.exitCode;
}

function main(): number {
  let argv;
  try {
    argv = parseReclaimArgv(process.argv.slice(2));
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + NL);
    process.stderr.write(
      'usage: turbo run docker:reclaim -- [--report] [--ttl-hours <n>]' + NL,
    );
    return STACK_AGE_EXIT.usage;
  }
  // Docker errors are OPERATIONAL: an unreachable daemon is a predicted
  // condition, not a programmer error, so it resolves to a graded exit with a
  // one-line reason rather than a stack trace. The THROW itself stays -- a
  // failed read must never degrade to "nothing is running", which is the
  // equivalence that let seven containers idle unnoticed -- but the operator
  // sees a verdict, not a trace.
  try {
    return argv.report ? reportMode(argv.ttlHours) : reclaimMode();
  } catch (err) {
    const reason = err instanceof Error ? (err.message.split(NL)[0] ?? err.message) : String(err);
    process.stderr.write('[docker:reclaim] FAILED -- ' + reason + NL);
    return STACK_AGE_EXIT.usage;
  }
}

const isMain = process.argv[1]?.endsWith('docker-reclaim.ts') ?? false;
if (isMain) {
  process.exit(main());
}
/* v8 ignore stop */
