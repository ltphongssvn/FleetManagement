// scripts/estate-verify-cli.ts
// Driver for estate:verify. Observes live git state, hands the OBSERVATION to
// the pure decider, and writes the result twice -- once for a machine, once for
// a person.
//
// OBSERVE, DECIDE, WRITE. Every fail-closed decision used to be made inline
// here, under a v8-ignore because this function spawns git -- so "git threw, so
// emit git-failed and exit 3" was verified by reading the code and nothing
// else. The decision now lives in decideEstate, which is pure and exhaustively
// tested, and this file only learns facts and prints them. That is the split
// decideClose and decideMergeReady already use, and the 2026 answer for
// subprocess-bearing CLIs: move the instantiation up a level and make the
// interaction the part under test.
//
// THE COMPOSITION ROOT. This is the only module that may spawn git, so it is
// where the raw porcelain is read -- and it hands those BYTES to observeEstate
// rather than parsing them itself. The constructor derives the digest and the
// records from the same string, so this file cannot produce an observation
// whose evidence disagrees with its states even by accident.
//
// STDOUT IS DATA; STDERR IS HUMANS. Exactly one NDJSON event on stdout and
// nothing else, so a caller pipes to jq without stripping prose; the readable
// summary goes to stderr.
//
// THE CHILD'S STREAMS ARE PIPED, NEVER INHERITED. Observed on the first live
// run: a branch with no upstream made git print "fatal: no upstream configured"
// straight to the console, so the task emitted prose beside the event it exists
// to keep clean. That state is NORMAL here, and the outcome is already
// expressed by returning an empty string.
//
// Every git call is execFileSync with an argv ARRAY and no shell -- the
// documented single-API fix for command injection.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  CorrelationIdSchema,
  DigestSchema,
  TimestampSchema,
  type EstateObservation,
} from './estate-events.js';
import { ESTATE_POLICY, PUSH_POLICY } from './estate-policy.js';
import { estateLineFor, runEstateVerify } from './estate-run.js';
import { estateStreams } from './estate-streams.js';
import {
  observeEstate,
  parseWorktreeRecords,
  unobservable,
  type GitOutcome,
  type ObservationContext,
  type WorktreeReadings,
  type WorktreeRecord,
} from './estate-gather.js';

// Re-exported under their original names: the rendering moved to the envelope
// and the porcelain parser moved to the observation boundary, so both share one
// definition -- but a caller that imported either from here still resolves it.
export { estateLineFor as estateLine };
export { parseWorktreeRecords };

const NL = String.fromCharCode(10);

/** What the CLI was asked to do. SCHEMA-FIRST at the argv boundary.
 *
 *  parseArgs owns the SURFACE -- flag syntax, unknown-flag rejection -- and Zod
 *  owns the CONTRACT. That split is the 2026 pattern, and the gap it fills is
 *  exactly what bit here: parseArgs happily accepts --expect-digest=garbage as
 *  a string, and the garbage then fails the comparison in decideEstate,
 *  producing STALE and REREAD_ESTATE. That tells the operator the estate moved
 *  when the truth is the digest is malformed -- a remedy that can never work,
 *  and for an agent an unbounded retry loop.
 *
 *  A bad flag VALUE is a usage error, exit 2, exactly as a bad flag NAME is. */
export const EstateArgvSchema = z.strictObject({
  quiet: z.boolean(),
  /** Decide under PUSH_POLICY, where `unpushed` is not a defect.
   *
   *  A FLAG, not an inference from the environment. The CLI could sniff for a
   *  pre-push context, but a gate whose rules change based on something it
   *  guessed is a gate nobody can reason about -- and the policy digest on the
   *  emitted event would then name a policy the caller never chose. The hook
   *  passes this explicitly, so the relaxation is visible in the hook entry, in
   *  the argv, and in the digest. */
  pushing: z.boolean(),
  expectDigest: DigestSchema.nullable(),
});
export type EstateArgv = z.infer<typeof EstateArgvSchema>;

// strict is the default, so a typo throws rather than yielding a confident
// no-op -- the failure deps-reconcile-cli.ts documents and worktree:sweep hit.
export function parseEstateArgv(argv: readonly string[]): EstateArgv {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      quiet: { type: 'boolean', default: false },
      pushing: { type: 'boolean', default: false },
      'expect-digest': { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  });
  // parse, not safeParse: parseEstateArgv already throws for a bad flag name
  // and the caller turns any throw into exit 2 with the usage line. A bad flag
  // VALUE takes the same path, so the two kinds of usage error are reported
  // identically rather than one of them becoming a verdict.
  return EstateArgvSchema.parse({
    quiet: values.quiet,
    pushing: values.pushing,
    expectDigest: values['expect-digest'] ?? null,
  });
}

/* v8 ignore start -- side-effecting entrypoint; every decision above and in
   decideEstate is unit-tested */
// stdio pipes BOTH child streams. Inheriting stderr let git narrate expected
// failures onto the console; capturing it keeps this task's contract intact.
const GIT_STDIO = ['ignore', 'pipe', 'pipe'] as const;

function git(args: readonly string[], cwd?: string): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: [...GIT_STDIO],
  }).trim();
}

// The EXIT CODE is preserved, not swallowed. Returning '' on failure made a
// failed command indistinguishable from one that printed nothing, and
// countLines('') is 0 -- so a failed git status read as a clean tree.
function gitOutcome(args: readonly string[], cwd?: string): GitOutcome {
  try {
    return { ok: true, out: git(args, cwd) };
  } catch {
    return { ok: false };
  }
}

/** The four readings one worktree needs. READ FIRST, DECIDE SECOND: every
 *  reading is captured with its exit code intact, then handed to a pure
 *  function that knows which failures are normal and which are defects. */
function readingsFor(rec: WorktreeRecord): WorktreeReadings {
  const upstream = gitOutcome(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    rec.path,
  );
  return {
    upstream,
    ahead: upstream.ok && upstream.out.length > 0
      ? gitOutcome(["rev-list", "--count", upstream.out + "..HEAD"], rec.path)
      : { ok: false },
    status: gitOutcome(["status", "--porcelain=v1", "--untracked-files=all"], rec.path),
    stash: gitOutcome(["stash", "list"], rec.path),
  };
}

/** Learn what git has to say, as a VERSIONED OBSERVATION.
 *
 *  The correlation id is fresh per run: this process is the root of its own
 *  workflow, and inheriting one from a traceparent would conflate W3C trace
 *  correlation with the event log's own. The two are distinct axes, which is
 *  why the envelope carries both. */
function observeLiveEstate(): EstateObservation {
  const ctx: ObservationContext = {
    correlationId: CorrelationIdSchema.parse(randomUUID()),
    occurredAt: TimestampSchema.parse(new Date().toISOString()),
  };
  let porcelain: string;
  try {
    porcelain = git(['worktree', 'list', '--porcelain']);
  } catch {
    // NO PORCELAIN, so no digest: claiming one for evidence that does not exist
    // would fabricate provenance, which is why unobservable takes it optionally
    // and this path omits it.
    return unobservable('git-failed', ctx);
  }
  // The BYTES go in, never a parsed list: observeEstate hashes and parses them
  // together, so this file cannot pair a digest with unrelated states.
  return observeEstate(porcelain, readingsFor, ctx);
}

function mainEstateVerify(): number {
  let argv: EstateArgv;
  try {
    argv = parseEstateArgv(process.argv.slice(2));
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + NL);
    process.stderr.write('usage: turbo run estate:verify -- [--quiet] [--pushing] [--expect-digest=<sha256>]' + NL);
    return 2;
  }

  // INHERITED trace context, never invented. Present only when a parent -- CI,
  // gate:agent, an orchestrator -- exported a W3C traceparent. Observe, decide
  // and render all happen in runEstateVerify, so this file owns only argv, the
  // two streams and the exit code -- what a CLI should own.
  const result = runEstateVerify({
    gather: observeLiveEstate,
    expectDigest: argv.expectDigest,
    traceparent: process.env['TRACEPARENT'],
    policy: argv.pushing ? PUSH_POLICY : ESTATE_POLICY,
  });

  // WHICH BYTES GO WHERE is decided by estateStreams, which is pure and
  // asserted: exactly one NDJSON line on stdout, prose on stderr. This file
  // only performs the writes.
  const streams = estateStreams(result, argv.quiet);
  process.stdout.write(streams.stdout);
  if (streams.stderr.length > 0) process.stderr.write(streams.stderr);
  return result.exitCode;
}

const isMain = process.argv[1]?.endsWith('estate-verify-cli.ts') ?? false;
if (isMain) {
  process.exit(mainEstateVerify());
}
/* v8 ignore stop */
