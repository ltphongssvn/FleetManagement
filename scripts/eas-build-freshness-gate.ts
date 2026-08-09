// scripts/eas-build-freshness-gate.ts
// IMPERATIVE SHELL for the native-build freshness gate. Orchestration only:
// every decision lives in the pure cores (eas-build-observation.ts parses,
// eas-build-freshness.ts decides), which are exhaustively unit-tested with no
// I/O. Nothing here branches on business rules, so nothing here needs a stub
// of the eas subprocess to be trustworthy.
//
// WHAT THIS GATE ASSERTS. For each shipped platform, a SUCCESSFUL native build
// exists within the policy window. iOS errored for two months while Sentry
// fatals fired correctly and were dismissed; the missing control was never
// another notification but a check on the ABSENCE OF SUCCESS that FAILS.
//
// FAIL-CLOSED. Only `fresh` exits 0. Stale, never, unreadable evidence and even
// our own misconfiguration all exit non-zero, because an inability to prove
// freshness must never quietly produce success -- that is the original defect
// restated. There is deliberately no env escape hatch: an invisible bypass is
// how a control stops being one. An exception should be a reviewed change to
// the window, in git, not a variable someone exports once.
//
// Run: pnpm exec turbo run eas:freshness -- [--max-age-days N] [--platform p]

import { spawnSync } from 'node:child_process';
import { parseBuildObservation } from './eas-build-observation.js';
import {
  BUILD_PLATFORMS,
  classifyBuildFreshness,
  describeVerdict,
  exitCodeFor,
  telemetryFor,
  type BuildPlatform,
} from './eas-build-freshness.js';

const nl = String.fromCharCode(10);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Default window. A driver-facing app that cannot produce an installable
 *  build for a fortnight is broken whether or not anyone noticed. */
const DEFAULT_MAX_AGE_DAYS = 14;

interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * STDOUT IS DATA; STDERR IS DIAGNOSTICS. They must never be concatenated.
 *
 * An earlier draft returned the two streams joined, and the gate reported
 * ACQUISITION_FAILED against a perfectly healthy account: eas-cli writes an
 * upgrade banner ("eas-cli@21.7.0 is now available ... Proceeding with
 * outdated version") to STDERR, which landed in front of the JSON and made
 * JSON.parse throw. Every layer behaved correctly -- the shell simply handed
 * the boundary a corrupted payload. Proven by running the command twice: with
 * 2>/dev/null stdout is clean JSON from `[`, and with 2>&1 >/dev/null stderr
 * carries the banner alone.
 *
 * The same joined-stream idiom appears in pr-automerge.ts and pr-follow.ts,
 * where it is currently harmless only because gh prints no stderr banner on
 * success. That is a latent trap there, not a safe pattern.
 *
 * NO `?? ''` FALLBACKS: with encoding set, spawnSync types stdout/stderr as
 * string, so a nullish branch is unreachable -- it would satisfy nothing at
 * runtime while the coverage gate reported it forever, and no honest test
 * could close it.
 *
 * `--status finished` filters server-side, so `--limit 1` IS the newest
 * success: the single row requested is exactly the row the decision needs, so
 * there is no truncation risk. The parser still re-filters by status as
 * defence in depth against this flag being dropped later.
 */
function readBuilds(platform: BuildPlatform): CliResult {
  const r = spawnSync('eas', [
    'build:list',
    '--platform', platform,
    '--status', 'finished',
    '--limit', '1',
    '--json',
    '--non-interactive',
  ], { encoding: 'utf-8', cwd: 'apps/driver-app', stdio: ['ignore', 'pipe', 'pipe'] });
  return { stdout: r.stdout, stderr: r.stderr };
}

function main(): number {
  const rawDays = argValue('--max-age-days');
  const maxAgeDays = rawDays === undefined ? DEFAULT_MAX_AGE_DAYS : Number(rawDays);
  const only = argValue('--platform');
  const targets = only === undefined
    ? BUILD_PLATFORMS
    : BUILD_PLATFORMS.filter((p) => p === only);

  if (targets.length === 0) {
    process.stderr.write('[eas:freshness] unknown platform: ' + String(only) + nl);
    return 4;
  }

  let worst = 0;
  for (const platform of targets) {
    const cli = readBuilds(platform);
    const verdict = classifyBuildFreshness({
      observation: parseBuildObservation(cli.stdout),
      nowMs: Date.now(),
      maxAgeMs: maxAgeDays * DAY_MS,
      platform,
    });

    // Structured truth first; the prose is derived from the same verdict rather
    // than being the thing machines have to parse.
    process.stdout.write(JSON.stringify(telemetryFor(verdict)) + nl);

    const code = exitCodeFor(verdict);
    const line = '[eas:freshness] ' + describeVerdict(verdict) + nl;
    if (code === 0) process.stdout.write(line);
    else process.stderr.write(line);

    // Preserve what the CLI actually said when the evidence was unreadable.
    // Verdicts that mask the initial error context are how a root cause hides
    // in the logs -- the failure mode this whole arc exists to end.
    if (verdict.kind === 'invalid-observation' && cli.stderr.trim().length > 0) {
      process.stderr.write('[eas:freshness] eas stderr: ' + cli.stderr.trim() + nl);
    }

    // Report EVERY platform before failing: exiting on the first denial would
    // hide a second broken platform behind the first.
    worst = Math.max(worst, code);
  }
  return worst;
}

const isEntry = process.argv[1] !== undefined && import.meta.url === 'file://' + process.argv[1];
if (isEntry) { process.exit(main()); }
