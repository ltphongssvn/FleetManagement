// scripts/deps-reconcile.ts
// GREEN (t82 deps-reconcile arc, 2026-08-04): pure decision cores for the
// //#deps:reconcile task. No child_process, no fs, no pnpm. Callers gather
// state and pass it in; this module only decides and emits argv -- the same
// core/shell split close-worktree.ts and worktree-deps-status.ts use.
//
// WHY THIS EXISTS. sync:worktrees detects dependency drift and, by documented
// design, never heals it: "Reports, never heals: the operator decides when to
// install." Its wiring test enforces that as a contract, asserting the source
// contains neither "install --force" nor the frozen-lockfile flag, because an
// implicit install across 45 worktrees on a 9.7GiB box is destructive. That
// guard is correct and is left untouched. Remediation therefore lives here, in
// a separately registered task, and invoking it IS the operator deciding.
//
// The gap it closes, measured: a census of 45 worktrees reported 12 deps-stale
// under SIX distinct pnpm messages, with no way to act on any of them. Seven of
// the last ten commits to pnpm-workspace.yaml are security override-floor
// raises, and every one stales every worktree at once. Drift is not an incident
// here; it is the steady state. Detection alone leaves 12 permanently yellow
// lines that an operator learns to scroll past.
//
// INSTRUMENT. pnpm's docs: the frozen-lockfile install does not generate a
// lockfile and fails when the lockfile is out of sync with the manifest. Two
// consequences carry the whole design. It cannot rewrite pnpm-lock.yaml, so it
// cannot resurrect the auto-install treadmill that verifyDepsBeforeRun: warn
// exists to suppress. And its outcome CLASSIFIES: exit 0 means the tree merely
// lagged an already-correct lockfile; ERR_PNPM_OUTDATED_LOCKFILE means lockfile
// and manifests genuinely disagree, which is a human commit and never an
// auto-heal. Attempting the heal is therefore the discriminator, in place of
// matching six message strings that any pnpm release may reword.
//
// SEQUENTIAL, and for the right reason. pnpm maintainers confirm concurrent
// installs against one content-addressable store are safe because store
// operations are atomic, so the store is NOT the constraint. Memory contention
// on a 9.7GiB box is -- the same SSOT that pins broad gates to concurrency 1.
// Caveat recorded: pnpm store prune must never run while an install is running.
import { z } from 'zod';
import type { DepsProbe } from './worktree-deps-status.js';
// ---------------------------- INPUT (tier 2 output) ------------------------
// DepsProbe is IMPORTED, never redeclared. An earlier draft of this file
// hand-wrote a structurally identical union here and even documented it as
// "structurally identical" -- a single-source-of-truth violation that no cheap
// detector catches: the copy was exported AND used, so dead-code analysis saw
// nothing, and it lived in a different module, so no duplicate-type lint
// applied. A third member added to the probe union would have compiled on both
// sides and diverged silently. Importing removes the possibility instead of
// detecting the symptom.
//
// NOT Zod-validated, deliberately: this is trusted internal data produced by
// interpretDepsProbe, a tested pure function in this repo. The two-axis rule
// forbids re-validating already-typed internal data; runtime parsing belongs
// only at the subprocess boundary below.
export type ReconcilePlan =
  | { action: 'skip'; reason: 'deps-ok' | 'toolchain-blocked' }
  | { action: 'heal'; detail: string };
// A poisoned pnpm pin is NOT drift. pnpm refuses to install v11.13.0 at all, so
// healing there is a guaranteed-failing retry on every run forever -- the
// unbounded-retry anti-pattern. The version is never named here: tier 2 already
// derived the toolchain-blocked discriminant, so the policy arrives as data.
export function decideReconcile(probe: DepsProbe): ReconcilePlan {
  if (probe.kind === 'deps-ok') return { action: 'skip', reason: 'deps-ok' };
  if (probe.kind === 'toolchain-blocked') {
    return { action: 'skip', reason: 'toolchain-blocked' };
  }
  return { action: 'heal', detail: probe.reason };
}
// ---------------------------- ARGV (pinned contract) -----------------------
// Frozen by construction. The frozen-lockfile install reconciles node_modules
// or fails; it can never write pnpm-lock.yaml. NDJSON so classification reads a
// documented machine format rather than prose. Deliberately NOT pnpm ci, which
// runs pnpm clean first: purging and re-downloading 1807 packages across 45
// worktrees is a cure worse than the drift.
export function healArgs(): readonly string[] {
  return ['install', '--frozen-lockfile', '--reporter=ndjson'];
}
// ---------------------------- BOUNDARY (Axis 1) ----------------------------
// The ONE real trust boundary in this module: bytes from a subprocess.
// worktree-deps-status.ts hand-narrows the same shape and says why -- "this
// data comes from a subprocess, which is a trust boundary". A schema is the
// house-correct form of that narrowing, matching WorktreeCloseInputSchema.
// safeParse, never parse: a malformed line on worktree 7 of 45 must degrade
// that worktree to a fail-closed verdict, not abort the sweep.
export const PnpmNdjsonRecordSchema = z.object({
  level: z.string(),
  err: z.object({
    code: z.string(),
    message: z.string().optional(),
  }),
});
export type PnpmNdjsonRecord = z.infer<typeof PnpmNdjsonRecordSchema>;
// ---------------------------- OUTCOME --------------------------------------
// source is reported alongside kind because the two are independently
// actionable. A divergent verdict read from NDJSON is authoritative; the same
// verdict read from prose means pnpm changed its output and the parser is
// running on borrowed time; a timeout is not a reading at all. Collapsing them
// into one field would hide from the operator which of those just happened.
export type HealSource =
  | 'exit-zero'
  | 'ndjson'
  | 'prose-fallback'
  | 'timeout'
  | 'unparseable';
export type HealResult =
  | { kind: 'reconciled'; source: 'exit-zero' }
  | { kind: 'divergent'; source: HealSource; reason: string }
  | { kind: 'failed'; source: HealSource; reason: string };
const OUTDATED = 'ERR_PNPM_OUTDATED_LOCKFILE';
const NL = String.fromCharCode(10);
function findRecord(lines: readonly string[]): PnpmNdjsonRecord | null {
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const result = PnpmNdjsonRecordSchema.safeParse(parsed);
    if (result.success) return result.data;
  }
  return null;
}
// FAILS CLOSED, mirroring gate:agent and interpretDepsProbe: only an explicit
// exit 0 is a pass. A null status (timeout SIGTERM) and unparseable output both
// resolve to failed, never to reconciled.
export function interpretHealResult(
  exitCode: number | null,
  output: string,
): HealResult {
  if (exitCode === 0) return { kind: 'reconciled', source: 'exit-zero' };
  if (exitCode === null) {
    return { kind: 'failed', source: 'timeout', reason: 'heal timed out and was killed' };
  }
  const lines = output.split(NL).map((l) => l.trim());
  const record = findRecord(lines);
  if (record !== null) {
    const reason = record.err.message ?? record.err.code;
    return record.err.code === OUTDATED
      ? { kind: 'divergent', source: 'ndjson', reason }
      : { kind: 'failed', source: 'ndjson', reason };
  }
  const prose = lines.find((l) => l.includes(OUTDATED));
  if (prose !== undefined) {
    return { kind: 'divergent', source: 'prose-fallback', reason: prose };
  }
  const first = lines.find((l) => l.length > 0);
  return {
    kind: 'failed',
    source: 'unparseable',
    reason: first ?? 'heal failed with no diagnostic output',
  };
}
// ---------------------------- CONSENT --------------------------------------
// Dry-run by default, matching every mutating task here (repair:*,
// intake:redrive) and the 2026 remediation-CLI convention. Consent is explicit,
// never ambient: an exact --execute and nothing else.
export function resolveExecute(argv: readonly string[]): boolean {
  return argv.includes('--execute');
}
// ---------------------------- EXIT -----------------------------------------
// GRADED, and the vocabulary lives HERE so the driver cannot invent its own.
// The two failure modes need OPPOSITE responses -- divergent means go fix a
// lockfile and commit it; failed means investigate the tool or network and
// re-run -- so a single non-zero would tell the operator that something broke
// without telling them what to do about it.
//
// 2 IS RESERVED FOR USAGE. The universal CLI convention is 0 success, 1 general
// error, 2 usage error, and codes 1-2 are documented as reserved. An earlier
// draft of this file put failed on 2, which would have made an operator typo
// and a failed 45-worktree sweep indistinguishable within the same tool. Usage
// takes 2 back and failed moves to 3, which also keeps the whole set in the low
// range this repo already uses (pr:follow exits 0/1/2/3).
//
// failed DOMINATES divergent: a sweep that failed partway is untrustworthy, so
// its divergent findings may be incomplete and must not read as the whole
// picture.
export const RECONCILE_EXIT = {
  ok: 0,
  divergent: 1,
  usage: 2,
  failed: 3,
} as const;
export interface ReconcileSummary {
  reconciled: number;
  divergent: number;
  failed: number;
  skipped: number;
}
export function reconcileExitCode(s: ReconcileSummary): number {
  if (s.failed > 0) return RECONCILE_EXIT.failed;
  if (s.divergent > 0) return RECONCILE_EXIT.divergent;
  return RECONCILE_EXIT.ok;
}
