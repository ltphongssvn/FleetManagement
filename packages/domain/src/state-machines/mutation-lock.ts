// packages/domain/src/state-machines/mutation-lock.ts
// Mutation-lock state machine per Frozen Stack PDF:
//   unlocked | grace_active | locked_pending_refresh | locked_pending_reauth
//
// This is the first domain primitive — guards offline mutations on the
// driver/yard app. The state machine prevents conflicting writes when
// config refreshes or re-authentication are in progress.

/**
 * The four legal states of the mutation lock.
 * Matches PDF: "Mutation-lock state machine: unlocked | grace_active |
 * locked_pending_refresh | locked_pending_reauth"
 */
export type MutationLockState =
  | 'unlocked'
  | 'grace_active'
  | 'locked_pending_refresh'
  | 'locked_pending_reauth';

/** Readonly tuple of all valid states for runtime validation. */
export const MUTATION_LOCK_STATES: readonly MutationLockState[] = [
  'unlocked',
  'grace_active',
  'locked_pending_refresh',
  'locked_pending_reauth',
] as const;
