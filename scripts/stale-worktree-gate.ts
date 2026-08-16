// scripts/stale-worktree-gate.ts
// Pure core of the stale-worktree gate: a worktree that is FINISHED and IDLE
// is debt, and must fail a gate rather than park on disk indefinitely.
//
// THE INCIDENT. Closing t1-wt2-cf-beacon-no-transform reported
//   ahead=117 dirty=0 upstream=true contained=true retired=false idleH=604
// -- every commit already in origin/develop, untouched for 25 days, with six
// siblings in the same state. The predicate bug that refused them is fixed
// (#550); nothing yet makes anyone RECLAIM them, so residue accumulates until
// somebody happens to read a census.
//
// ONE THRESHOLD, NOT TWO. close-worktree.ts already owns
// RECENT_IDLE_THRESHOLD_HOURS = 24 as the line between LIVE (protected from
// closing) and STALE (removable). Only half that invariant was enforced:
// worktree:close refuses to delete a live worktree, but nothing insisted a
// stale one be closed. This is the missing half, and it takes the threshold as
// an INPUT so the caller can pass the shared constant -- two independently
// tuned numbers would eventually disagree, and a worktree could then be
// gate-flagged and close-refused at once, an unresolvable state.
//
// WHY NOT "STALE" ALONE. Measured on this estate: 38 of 48 worktrees exceed
// 24h idle. A gate failing on all of them would be born red, make every branch
// unmergeable simultaneously, and teach everyone to ignore it -- the documented
// reason //#typecheck:scripts stayed ungated until it reached zero. Long-lived
// idle work in progress is legitimate. Finished work nobody reclaimed is not.
//
// SO: stale AND closeable. Closeable means decideClose would return `remove`
// (contained, clean, pushed, non-primary): the work has landed, nothing can be
// lost, and the directory is pure residue. That set is naturally near-zero, so
// the gate is born green and every future firing means something.

/** One worktree as the driver observed it. `closeable` is decideClose's own
 *  verdict, not a re-derivation -- re-implementing that predicate here is how
 *  the two would drift apart, exactly as pr-follow and pr-automerge did. */
export interface WorktreeObservation {
  readonly path: string;
  /** null for a DETACHED worktree: `git worktree list --porcelain` omits the
   *  branch line entirely there, and sync:worktrees reports a `detached` count,
   *  so this is a real state on this estate rather than a theoretical one. A
   *  detached worktree can never be closeable (decideClose requires a branch),
   *  but the type must say so instead of asserting a string that may not
   *  exist -- typecheck caught exactly that assumption here. */
  readonly branch: string | null;
  readonly idleHours: number;
  readonly closeable: boolean;
}

export interface StaleGateInput {
  readonly worktrees: readonly WorktreeObservation[];
  readonly maxIdleHours: number;
}

export type StaleGateVerdict =
  | { readonly kind: 'clean' }
  | { readonly kind: 'reclaimable'; readonly worktrees: readonly WorktreeObservation[] }
  | { readonly kind: 'invalid-policy'; readonly code: 'NON_POSITIVE_WINDOW' | 'NON_FINITE_WINDOW' };

function assertNever(x: never): never {
  throw new Error('unhandled verdict: ' + JSON.stringify(x));
}

/**
 * Decide. Policy is validated BEFORE evidence: a zero or negative window would
 * mark every worktree reclaimable including the one being worked in right now,
 * so a misconfiguration must fail closed rather than produce a confident list.
 */
export function classifyStaleWorktrees(input: StaleGateInput): StaleGateVerdict {
  const { worktrees, maxIdleHours } = input;

  if (!Number.isFinite(maxIdleHours)) {
    return { kind: 'invalid-policy', code: 'NON_FINITE_WINDOW' };
  }
  if (maxIdleHours <= 0) {
    return { kind: 'invalid-policy', code: 'NON_POSITIVE_WINDOW' };
  }

  const reclaimable = worktrees.filter((w) => {
    // An unreadable reflog is NOT evidence of staleness. close-worktree fails
    // safe by defaulting idleHours to 0 (protected); this mirrors that, so a
    // measurement failure can never manufacture a deletion candidate.
    if (!Number.isFinite(w.idleHours)) return false;
    if (!w.closeable) return false;
    // Strict >, so exactly at the threshold is ACTIVE -- decideClose uses
    // strict < for `recent`, and the two must agree at the boundary.
    return w.idleHours > maxIdleHours;
  });

  return reclaimable.length === 0
    ? { kind: 'clean' }
    : { kind: 'reclaimable', worktrees: reclaimable };
}

const hours = (h: number): string => String(Math.floor(h));

/**
 * Operator message. Names every path, its idle time, and THE REMEDY: a gate
 * that reports a problem without the command that fixes it costs the reader a
 * search, and searches are what get deferred.
 */
export function describeStaleWorktrees(worktrees: readonly WorktreeObservation[]): string {
  const lines = worktrees.map(
    (w) => '  ' + w.path + ' (' + (w.branch ?? 'detached') + ') idle ' + hours(w.idleHours) + 'h',
  );
  return 'These worktrees are fully merged, clean and idle -- their work has ' +
    'landed and the directories are residue:' + String.fromCharCode(10) +
    lines.join(String.fromCharCode(10)) + String.fromCharCode(10) +
    'Reclaim each with: pnpm exec turbo run worktree:close -- <path>';
}

/**
 * Fail-closed exit mapping. Only `clean` authorises; a misconfigured policy
 * denies too, because an inability to evaluate the invariant must never read
 * as satisfying it.
 */
export function exitCodeForStaleGate(v: StaleGateVerdict): number {
  switch (v.kind) {
    case 'clean':
      return 0;
    case 'reclaimable':
      return 1;
    case 'invalid-policy':
      return 2;
    default:
      return assertNever(v);
  }
}
