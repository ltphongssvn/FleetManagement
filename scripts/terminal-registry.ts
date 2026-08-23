// scripts/terminal-registry.ts
// Terminal-number allocation for the t<N>-wt<M>-<slug> worktree convention.
//
// ROOT CAUSE THIS FIXES. Numbers were allocated from the sync:worktrees
// census, which reads `git worktree list` -- the LOCAL worktrees of ONE
// machine. This repo is developed from two laptops sharing one remote, so each
// census sees only its own half of the sequence. The MacBook reported a
// high-water of t77 while the WSL2 laptop was already at t88, and t78 was cut
// on top of a terminal that had been in use for ten allocations. The identical
// class forced the t16 -> t19 rename three months earlier.
//
// The census also FORGETS. Closing a worktree removes it from
// `git worktree list`, so the high-water DROPS: after t89 closed, the local
// census reported t77 again and would have re-issued t78 a second time.
//
// THE FIX. Allocate from the remote ref namespace. Per 2026 practice for
// parallel worktrees across machines, agents "coordinate through the remote
// ref namespace -- the one place git is designed for concurrent access
// (append-only via pack-refs and server-side locking)". Each cut publishes
// refs/terminals/<N>; the ceiling is the maximum over
// refs/remotes/origin/terminals/*, which every machine already has locally
// after the `fetch --all --prune` sync:worktrees runs at startup.
//
// Terminal refs are NEVER deleted, so a closed worktree cannot lower the
// ceiling and a number is never re-issued. They point at an empty blob: the
// ref's NAME is the whole payload, so nothing has to be kept in sync.
//
// Pure core here; the git calls live in the CLI shell. Same shape as
// compose-identity.ts, which solved the sibling problem (per-worktree Docker
// project names) by deriving identity rather than allocating a shared counter.

const TERMINAL_REF_PREFIX = 'refs/terminals/';
const REMOTE_TERMINAL_RE = /^refs\/remotes\/[^/]+\/terminals\/(\d+)$/;
// Lowercase, digits and single hyphens: the value becomes a directory name and
// part of a compose project identity downstream.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The ref a newly cut worktree publishes to claim its terminal number. */
export function terminalRefName(terminal: number): string {
  if (!Number.isInteger(terminal) || terminal < 1) {
    throw new Error(
      'terminalRefName: terminal must be a positive integer, got ' + String(terminal),
    );
  }
  return TERMINAL_REF_PREFIX + String(terminal);
}

/** Terminal numbers present in a list of remote-tracking ref names.
 *
 *  A leaf that is not a bare integer is IGNORED rather than coerced: reading a
 *  malformed ref as 0 would let one corrupt entry silently lower the ceiling
 *  and hand out a number already in use. */
export function parseTerminalRefs(refNames: readonly string[]): number[] {
  const out: number[] = [];
  for (const name of refNames) {
    const m = REMOTE_TERMINAL_RE.exec(name);
    const digits = m?.[1];
    if (digits !== undefined) out.push(Number(digits));
  }
  return out;
}

/** One past the highest PUBLISHED terminal, across every machine.
 *
 *  Derived from published refs rather than live worktrees, so closing a
 *  worktree cannot lower it. */
export function nextTerminalNumber(published: readonly number[]): number {
  return published.length === 0 ? 1 : Math.max(...published) + 1;
}

/** The conventional worktree directory name. */
export function worktreeDirName(terminal: number, worktree: number, slug: string): string {
  if (!Number.isInteger(terminal) || terminal < 1) {
    throw new Error('worktreeDirName: terminal must be a positive integer');
  }
  if (!Number.isInteger(worktree) || worktree < 1) {
    throw new Error('worktreeDirName: worktree must be a positive integer');
  }
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      'worktreeDirName: slug must be lowercase kebab-case, got ' + JSON.stringify(slug),
    );
  }
  return 't' + String(terminal) + '-wt' + String(worktree) + '-' + slug;
}

// ---- pure git argv planners (driver lives in the CLI shell) ----
// Same shape as worktree-close-cli.ts: the argv is planned here and asserted
// in tests, so the exact commands are verified without spawning git.

/** Provenance recorded in the claim blob: which machine took the terminal and
 *  when. Content must be UNIQUE per claim -- see claimTerminalArgs. */
export function claimBlobContent(host: string, isoTime: string): string {
  if (host.trim().length === 0) throw new Error('claimBlobContent: host required');
  if (isoTime.trim().length === 0) throw new Error('claimBlobContent: isoTime required');
  return 'terminal claimed by ' + host.trim() + ' at ' + isoTime.trim() + String.fromCharCode(10);
}

/** Every published terminal claim, across all machines.
 *
 *  The pattern is a plain PREFIX. for-each-ref matches whole path components,
 *  so a mid-path wildcard ('refs/remotes/*' + '/terminals/') matches NOTHING --
 *  and it fails silently, returning an empty list that reads as "no terminals
 *  claimed" and hands out terminal 1. Proven live against a registry that
 *  demonstrably held 89 and 90. parseTerminalRefs already tolerates any remote
 *  name, so filtering by prefix here loses nothing. */
export function listTerminalRefsArgs(): string[] {
  return ['for-each-ref', '--format=%(refname)', 'refs/remotes/'];
}

/** Claim a terminal by publishing its ref, as a compare-and-swap.
 *
 *  --force-with-lease=<ref>: with an EMPTY expected value is git's documented
 *  create-if-absent: "an empty string as <old-oid> ... makes sure that the ref
 *  you are creating does not exist". Despite the name it forces nothing; it is
 *  the remote equivalent of update-ref's `create`, which verifies absence.
 *
 *  The object MUST be unique per claim, which is why the blob carries host and
 *  timestamp. Proven live: when two machines claimed the same terminal with an
 *  IDENTICAL object (the empty tree), BOTH pushes reported "Everything
 *  up-to-date" and exited 0 -- git short-circuits before evaluating the lease
 *  because the ref already holds the value being pushed, so there is no update
 *  to check. With distinct objects the second claim is rejected "(stale info)"
 *  with exit 1, which is the mutual exclusion this registry depends on. */
export function claimTerminalArgs(terminal: number, blobSha: string): string[] {
  const ref = terminalRefName(terminal);
  return ['push', '--force-with-lease=' + ref + ':', 'origin', blobSha + ':' + ref];
}

/** One census line for sync:worktrees.
 *
 *  The registry only helps if the number reaches the operator. sync:worktrees
 *  prints the census that terminal numbers have always been read from, so the
 *  ceiling belongs in its summary -- otherwise the correct answer exists and
 *  nobody sees it, and the local high-water gets reused out of habit.
 *
 *  An EMPTY registry is ambiguous: either nothing was ever claimed, or the
 *  terminal refs were never fetched (they are not in the default refspec).
 *  Answering "t1" flatly would re-issue a burned number, so this warns instead
 *  -- the same fail-closed posture the rest of these tasks take. */
export function formatTerminalCensus(published: readonly number[]): string {
  if (published.length === 0) {
    return 'Terminals: no terminals published (registry empty, or refs/terminals/* not fetched)';
  }
  const next = nextTerminalNumber(published);
  return (
    'Terminals: ' +
    String(published.length) +
    ' published, highest t' +
    String(Math.max(...published)) +
    ' -- next terminal: t' +
    String(next)
  );
}
