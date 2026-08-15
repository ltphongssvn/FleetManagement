// scripts/estate-verify-cli.ts
// Driver for estate:verify. Gathers live git state, hands it to the pure
// decider, and writes the result twice -- once for a machine, once for a person.
//
// GATHER, DECIDE, WRITE. Every fail-closed decision used to be made inline
// here, under a v8-ignore because this function spawns git -- so "git threw, so
// emit git-failed and exit 3" was verified by reading the code and nothing
// else. The decision now lives in decideEstate, which is pure and exhaustively
// tested, and this file only learns facts and prints them. That is the split
// decideClose and decideMergeReady already use, and the 2026 answer for
// subprocess-bearing CLIs: move the instantiation up a level and make the
// interaction the part under test.
//
// STDOUT IS DATA; STDERR IS HUMANS. Exactly one NDJSON event on stdout and
// nothing else, so a caller pipes to jq without stripping prose; the readable
// summary goes to stderr. Same split sh() in pr-automerge.ts documents after a
// transient gh message landed in front of JSON and was classified as a
// permanent contract violation.
//
// THE CHILD'S STREAMS ARE PIPED, NEVER INHERITED. Observed on the first live
// run: a branch with no upstream made git print "fatal: no upstream configured"
// straight to the console, so the task emitted prose beside the event it exists
// to keep clean. That state is NORMAL here, and the outcome is already
// expressed by returning an empty string.
//
// Every git call is execFileSync with an argv ARRAY and no shell -- the
// documented single-API fix for command injection. Paths from porcelain are
// canonicalised, then parsed through WorktreeStateSchema before any becomes a
// cwd.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  digestOf,
  toWorktreeState,
  type EstateGathered,
  type WorktreeState,
} from './estate-verify.js';
import { estateLineFor, runEstateVerify } from './estate-run.js';

// Re-exported under its original name: the rendering moved to the envelope so
// both surfaces share one wording, and a caller that imported it from here
// still resolves it.
export { estateLineFor as estateLine };

const NL = String.fromCharCode(10);

export interface EstateArgv {
  /** If-Match: act only if the estate is still this digest. */
  readonly expectDigest: string | null;
  readonly quiet: boolean;
}

// strict is the default, so a typo throws rather than yielding a confident
// no-op -- the failure deps-reconcile-cli.ts documents and worktree:sweep hit.
export function parseEstateArgv(argv: readonly string[]): EstateArgv {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      quiet: { type: 'boolean', default: false },
      'expect-digest': { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  });
  return { quiet: values.quiet, expectDigest: values['expect-digest'] ?? null };
}

/** One worktree record from `git worktree list --porcelain`. Blank-line
 *  separated; a record may carry bare `locked` / `prunable` markers, and a
 *  detached one carries no `branch` line at all. */
export function parseWorktreeRecords(
  porcelain: string,
): readonly { path: string; branch: string; locked: boolean; prunable: boolean }[] {
  const out: { path: string; branch: string; locked: boolean; prunable: boolean }[] = [];
  let cur: { path: string; branch: string; locked: boolean; prunable: boolean } | null = null;
  for (const line of porcelain.split(NL)) {
    if (line.startsWith('worktree ')) {
      if (cur !== null) out.push(cur);
      // Canonicalised HERE, before the schema sees it: porcelain is normally
      // absolute, but resolve also flattens any .. segment or trailing slash so
      // the same worktree can never appear under two spellings.
      cur = {
        path: resolve(line.slice('worktree '.length)),
        branch: '(detached)',
        locked: false,
        prunable: false,
      };
    } else if (cur === null) {
      continue;
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace('refs/heads/', '');
    } else if (line === 'locked' || line.startsWith('locked ')) {
      cur.locked = true;
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      cur.prunable = true;
    }
  }
  if (cur !== null) out.push(cur);
  return out;
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

function gitAllowFail(args: readonly string[], cwd?: string): string {
  try {
    return git(args, cwd);
  } catch {
    return '';
  }
}

function countLines(s: string): number {
  return s.length === 0 ? 0 : s.split(NL).length;
}

function gatherOne(rec: ReturnType<typeof parseWorktreeRecords>[number]): WorktreeState | null {
  const upstream = gitAllowFail(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    rec.path,
  );
  const ahead = upstream.length > 0
    ? Number(gitAllowFail(['rev-list', '--count', upstream + '..HEAD'], rec.path) || '0')
    : 0;
  // toWorktreeState uses safeParse, so a record the schema rejects returns null
  // instead of throwing an uncaught ZodError past the one-event contract.
  return toWorktreeState({
    path: rec.path,
    branch: rec.branch,
    dirtyFileCount: countLines(
      gitAllowFail(['status', '--porcelain=v1', '--untracked-files=all'], rec.path),
    ),
    aheadOfRemote: Number.isFinite(ahead) ? ahead : 0,
    stashCount: countLines(gitAllowFail(['stash', 'list'], rec.path)),
    prunable: rec.prunable,
    locked: rec.locked,
  });
}

/** Learn what git has to say. Returns FACTS only -- no verdict, no exit code. */
function gatherEstate(): EstateGathered {
  let porcelain: string;
  try {
    porcelain = git(['worktree', 'list', '--porcelain']);
  } catch {
    return { kind: 'git-failed' };
  }
  const sourceDigest = digestOf(porcelain);

  const records = parseWorktreeRecords(porcelain);
  // A CONFIDENT ZERO: git exited 0 yet produced no worktree record, and
  // `git worktree list` in any valid repository lists at least the MAIN
  // worktree. Zero is therefore never a legitimate answer.
  if (records.length === 0) return { kind: 'no-records', sourceDigest };

  const gathered = records.map(gatherOne);
  if (gathered.some((s) => s === null)) {
    return { kind: 'record-rejected', sourceDigest };
  }
  return {
    kind: 'states',
    states: gathered.filter((s): s is WorktreeState => s !== null),
    sourceDigest,
  };
}

function mainEstateVerify(): number {
  let argv: EstateArgv;
  try {
    argv = parseEstateArgv(process.argv.slice(2));
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + NL);
    process.stderr.write('usage: turbo run estate:verify -- [--quiet] [--expect-digest=<sha256>]' + NL);
    return 2;
  }

  // INHERITED trace context, never invented. Present only when a parent -- CI,
  // gate:agent, an orchestrator -- exported a W3C traceparent.
  // A span of OUR OWN inside the caller's trace. Copying the parent's span_id
  // would attribute this task's events to the parent's span, leaving a hole in
  // the trace exactly where the work happened.
  // Gather, decide and render all happen in runEstateVerify, so this file owns
  // only argv, the two streams and the exit code -- what a CLI should own. An
  // in-process runtime calls the same function and reads the same fields.
  const result = runEstateVerify({
    gather: gatherEstate,
    expectDigest: argv.expectDigest,
    traceparent: process.env['TRACEPARENT'],
  });

  process.stdout.write(JSON.stringify(result.event) + NL);
  if (argv.quiet) return result.exitCode;
  process.stderr.write(result.line + NL);
  return result.exitCode;
}

const isMain = process.argv[1]?.endsWith('estate-verify-cli.ts') ?? false;
if (isMain) {
  process.exit(mainEstateVerify());
}
/* v8 ignore stop */
