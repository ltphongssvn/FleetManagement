// scripts/estate-action.ts
// WHAT THE CALLER MAY DO, as a value rather than as prose.
//
// WHY THIS EXISTS. estate:verify reported what it OBSERVED -- clean, unclean,
// unreadable, stale -- and left the rule "do not close a session while work is
// in flight" living in the task description, where an orchestrator has to read
// English to learn it. The exit code encodes that rule, but an exit code
// reaches only a process PARENT: an agent consuming the NDJSON event stream
// from a collector sees no such field and must re-derive the policy from
// attributes, which is a second implementation waiting to disagree.
//
// 2026 agent-governance guidance draws exactly this line -- a behaviour
// contract must be machine-readable and versioned rather than prose the
// consumer interprets, and declaration alone is not enough: the value has to be
// the thing the caller branches on.
//
// THE HOUSE PRECEDENT IS ALREADY HERE. assert-parses.ts emits agent_action
// ('REGENERATE_FILE' | 'FIX_INVOCATION') beside its verdict for this reason.
// estate:verify emitting only observations was the inconsistency.
//
// ONE DERIVATION, THREE CHANNELS. The exit code, the emitted agent_action and
// the human line are one decision reaching three audiences, so all three come
// from ACTION_EXIT and actionForVerdict below. Declaring them separately is how
// a tool ends up exiting 0 while telling a subscriber to halt.
import { z } from 'zod';
import { REASON_KIND, type EstateReason } from './estate-verify.js';

/** What a caller may do next. Named for the ACTION, not the observation: a
 *  consumer should not have to know that clean:false means "stop". */
export const ESTATE_ACTIONS = Object.freeze([
  /** Nothing is in flight. A session may close, a sweep may run. */
  'PROCEED',
  /** The OPERATOR has unfinished work: dirty tree, unpushed commits, a stash.
   *  No tool may resolve this -- committing or pushing on someone's behalf is
   *  precisely the destructive autonomy worktree:close refuses. */
  'HALT_WORK_IN_PROGRESS',
  /** The WORKTREE is defective: prunable or locked. A git repair fixes it, so
   *  this is distinct from work in progress -- different owner, different fix. */
  'HALT_STRUCTURAL',
  /** The estate moved since the caller planned against it. Nothing is broken;
   *  re-read and re-decide. The If-Match/412 outcome. */
  'REREAD_ESTATE',
  /** The estate could not be read at all. A tooling failure, not a housekeeping
   *  observation, and acting on an unread estate is the confident-zero hazard. */
  'REPAIR_TOOLING',
] as const);
export type EstateAction = (typeof ESTATE_ACTIONS)[number];
export const EstateActionSchema = z.enum(ESTATE_ACTIONS);

/** The exit code accompanying each action. TOTAL over the vocabulary, so a new
 *  action without an exit code is a COMPILE error rather than a silent 0. */
export const ACTION_EXIT = Object.freeze({
  PROCEED: 0,
  HALT_WORK_IN_PROGRESS: 1,
  HALT_STRUCTURAL: 1,
  REREAD_ESTATE: 4,
  REPAIR_TOOLING: 3,
} as const) satisfies Readonly<Record<EstateAction, 0 | 1 | 3 | 4>>;

/** The exit code for an action. The SINGLE place a code is chosen. */
export function exitCodeFor<A extends EstateAction>(action: A): (typeof ACTION_EXIT)[A] {
  return ACTION_EXIT[action];
}

/** True when the action forbids closing a session or starting new work.
 *
 *  Exported as a PREDICATE rather than left to the consumer: "never declare the
 *  session closed while any problem remains" IS the contract, and a consumer
 *  re-deriving it from a string comparison is a second implementation. */
export function mayProceed(action: EstateAction): boolean {
  return action === 'PROCEED';
}

/** Which halt a set of reasons warrants.
 *
 *  STRUCTURAL DOMINATES. A worktree that is both dirty and prunable needs the
 *  git repair first: finishing work inside a worktree whose gitdir points
 *  nowhere is not possible, so reporting work-in-progress would send the
 *  operator to a remedy that cannot run. Derived from REASON_KIND rather than
 *  re-listing which reasons are structural -- that vocabulary is declared once. */
/** The actions a VERDICT can reach: a clean estate or one of the two halts.
 *  REREAD_ESTATE and REPAIR_TOOLING are decided BEFORE any verdict exists, so
 *  they are unreachable here -- and saying so in the type is what lets the
 *  decision's exitCode stay narrowed to 0|1 without a cast. */
export type VerdictAction = Extract<
  EstateAction,
  'PROCEED' | 'HALT_WORK_IN_PROGRESS' | 'HALT_STRUCTURAL'
>;

export function actionForReasons(reasons: readonly EstateReason[]): VerdictAction {
  if (reasons.length === 0) return 'PROCEED';
  const structural = reasons.some((r) => REASON_KIND[r] === 'structural');
  return structural ? 'HALT_STRUCTURAL' : 'HALT_WORK_IN_PROGRESS';
}

/** The action a VERDICT warrants: the flat reason set across the whole estate.
 *
 *  Takes reasons rather than the verdict object so the layering guard's rule
 *  holds -- this module states policy over vocabulary, and never reaches into
 *  a presentation artifact. */
export function actionForVerdict(reasons: readonly EstateReason[]): VerdictAction {
  return actionForReasons(reasons);
}
