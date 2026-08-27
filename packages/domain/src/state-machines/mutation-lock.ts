// packages/domain/src/state-machines/mutation-lock.ts
// Mutation-lock state machine per Frozen Stack PDF:
//   unlocked | grace_active | locked_pending_refresh | locked_pending_reauth
//
// Single source of truth: type derived from as const array (not duplicated).

/** Readonly tuple of all valid states — runtime + compile-time contract. */
export const MUTATION_LOCK_STATES = [
  'unlocked',
  'grace_active',
  'locked_pending_refresh',
  'locked_pending_reauth',
] as const;

/** Union type derived from the array — single source of truth. */
export type MutationLockState = (typeof MUTATION_LOCK_STATES)[number];
