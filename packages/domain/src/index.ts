// packages/domain/src/index.ts
// Barrel export for @fleet/domain package.
// Named exports only — no `export *` to prevent namespace pollution.
export { type MutationLockState, MUTATION_LOCK_STATES } from './state-machines/mutation-lock.js';
