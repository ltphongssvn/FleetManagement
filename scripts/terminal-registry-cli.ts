// scripts/terminal-registry-cli.ts
// IMPERATIVE SHELL for the terminal registry. Orchestration only: every rule
// lives in terminal-registry.ts, which is exhaustively unit-tested with no I/O.
//
// WHY THIS FILE EXISTS. The pure core has been complete and tested since it
// landed, but NO TASK EVER CALLED IT. The allocation rule was correct,
// verified, and unreachable -- so every claim was still typed by hand from
// memory, which is the uncaptured-idiom class the registered-task rule exists
// to remove. Three real guarantees were lost by hand-typing it:
//
//   1. NO LEASE. The hand-rolled claim was a plain `git push <sha>:<ref>` with
//      no --force-with-lease, so a concurrent claim from the other laptop would
//      have been SILENTLY OVERWRITTEN. git documents --force-with-lease as an
//      atomic compare-and-swap; claimTerminalArgs has always specified it and
//      nothing invoked it.
//   2. NETWORK READ PER INVOCATION. Hand-typed reads used a remote round-trip.
//      listTerminalRefsArgs reads refs/remotes/ LOCALLY via for-each-ref.
//   3. IDENTICAL-OBJECT SHORT-CIRCUIT. The core documents that two machines
//      pushing the SAME object both report "Everything up-to-date" and exit 0,
//      defeating the lease entirely. claimBlobContent carries host + timestamp
//      so every claim object is distinct. A hand-typed blob had no guarantee.
//
// BOTH COMMANDS FETCH FIRST. An earlier draft fetched only in claim(), on the
// reasoning that census is read-only. Proven wrong the first time it ran: after
// claim() took t100, census still reported "highest t99 -- next terminal: t100"
// from stale local tracking refs. A census that hands out a BURNED number is
// the exact failure this registry exists to end, and being read-only does not
// make being wrong acceptable. Terminal refs are not in the default refspec, so
// without an explicit fetch the local view is arbitrarily old.
//
// FETCH BEFORE LEASE is also the documented CI shape: the lease compares
// against what was last fetched, so a stale view weakens the compare-and-swap.
//
// Run:
//   pnpm exec turbo run terminal:census          -- read-only, prints ceiling
//   pnpm exec turbo run terminal:claim -- <slug> -- claim next + print dir name

import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import {
  claimBlobContent,
  claimTerminalArgs,
  formatTerminalCensus,
  listTerminalRefsArgs,
  nextTerminalNumber,
  parseTerminalRefs,
  terminalRefName,
  worktreeDirName,
} from './terminal-registry.js';

const nl = String.fromCharCode(10);

/** Terminal refs live outside the default refspec, so they must be asked for
 *  explicitly or the local view silently rots. */
const TERMINAL_REFSPEC = '+refs/terminals/*:refs/remotes/origin/terminals/*';

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

// stdout is DATA, stderr is DIAGNOSTICS -- never concatenated. Joining them is
// how a CLI banner ends up inside a parsed payload (eas-build-freshness-gate
// reported ACQUISITION_FAILED against a healthy account for exactly that).
function git(args: readonly string[], input?: string): Run {
  const r = spawnSync('git', [...args], {
    encoding: 'utf-8',
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status ?? 1 };
}

function fetchTerminalRefs(): Run {
  return git(['fetch', 'origin', TERMINAL_REFSPEC, '--prune']);
}

/** Published terminals, read from LOCAL remote-tracking refs after a fetch. */
function publishedTerminals(): number[] {
  const r = git(listTerminalRefsArgs());
  if (r.code !== 0) {
    process.stderr.write('[terminal] could not list refs: ' + r.stderr.trim() + nl);
    return [];
  }
  return parseTerminalRefs(r.stdout.split(nl).filter((l) => l.length > 0));
}

function census(): number {
  const fetched = fetchTerminalRefs();
  if (fetched.code !== 0) {
    // Report the staleness rather than printing a number that may be burned.
    process.stderr.write(
      '[terminal] fetch failed; the ceiling below may be ' +
        'STALE and must not be used to allocate: ' +
        fetched.stderr.trim() +
        nl,
    );
  }
  process.stdout.write(formatTerminalCensus(publishedTerminals()) + nl);
  return fetched.code === 0 ? 0 : 1;
}

function claim(slug: string): number {
  const fetched = fetchTerminalRefs();
  if (fetched.code !== 0) {
    process.stderr.write(
      '[terminal] fetch failed, refusing to allocate: ' + fetched.stderr.trim() + nl,
    );
    return 1;
  }

  const published = publishedTerminals();
  if (published.length === 0) {
    // Fail closed. An empty registry AFTER a successful fetch is far more
    // likely a refspec problem than a genuinely virgin repo, and answering t1
    // would re-issue a number in use -- the exact collision this registry
    // exists to end (t16->t19, t78->t89).
    process.stderr.write(
      '[terminal] registry empty after fetch -- refusing to ' +
        'allocate t1 blindly. Verify refs/terminals/* exist on origin.' +
        nl,
    );
    return 1;
  }

  const terminal = nextTerminalNumber(published);

  // Content MUST be unique per claim: two machines pushing an identical object
  // both short-circuit to "Everything up-to-date" and exit 0, which defeats the
  // lease. host + timestamp guarantees distinctness.
  const written = git(
    ['hash-object', '-w', '--stdin'],
    claimBlobContent(hostname(), new Date().toISOString()),
  );
  if (written.code !== 0) {
    process.stderr.write('[terminal] could not write claim blob: ' + written.stderr.trim() + nl);
    return 1;
  }
  const sha = written.stdout.trim();

  // Compare-and-swap: --force-with-lease=<ref>: with an EMPTY expected value is
  // create-if-absent. A concurrent claim is REJECTED here, never overwritten.
  const pushed = git(claimTerminalArgs(terminal, sha));
  if (pushed.code !== 0) {
    process.stderr.write(
      '[terminal] claim of t' +
        String(terminal) +
        ' REJECTED -- ' +
        'another machine took it first. Re-run to take the next number.' +
        nl +
        pushed.stderr.trim() +
        nl,
    );
    return 1;
  }

  process.stdout.write(terminalRefName(terminal) + nl);
  process.stdout.write(worktreeDirName(terminal, 1, slug) + nl);
  return 0;
}

function main(): number {
  const [cmd, slug] = process.argv.slice(2);
  if (cmd === 'census') return census();
  if (cmd === 'claim') {
    if (slug === undefined || slug.length === 0) {
      process.stderr.write('usage: terminal:claim -- <slug>' + nl);
      return 1;
    }
    return claim(slug);
  }
  process.stderr.write('usage: terminal:census | terminal:claim -- <slug>' + nl);
  return 1;
}

const isEntry = process.argv[1] !== undefined && import.meta.url === 'file://' + process.argv[1];
if (isEntry) {
  process.exit(main());
}
