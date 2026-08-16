// e2e/helpers/budgets.ts
// SSOT for the E2E timing budgets. Two NAMED budgets, because they answer two
// different questions -- collapsing them into one number is what made the last
// treadmill possible.
//
// ROOT CAUSE THIS CLOSES. Six spec files each declared their own
//   const ROW_VISIBILITY_BUDGET_MS = 15_000;
// copy-pasted, with no shared definition. That duplication is why a July budget
// raise on the khachhang specs healed nothing: the other four kept their own
// copies and kept failing. Raising a budget was never the fix anyway (see
// wait-for-projection.ts), but the duplication guaranteed that even a CORRECT
// change could only ever reach one caller at a time.
//
// 2026 practice puts shared timeouts in one constants module precisely so this
// cannot happen; the sibling guard test forbids re-declaring a per-spec copy,
// which is what turns the convention into a constraint rather than a hope.

/** How long a DOM assertion may wait once the data it needs is ALREADY known to
 *  exist -- i.e. after settleBoardAfterCreate has established readiness, or for
 *  UI that does not depend on the projection at all (drawers, banners,
 *  comboboxes). Generous because CI machines are slow and contended, not
 *  because anything asynchronous is being raced.
 *
 *  NOT a substitute for settling: if an assertion needs this budget to pass, it
 *  is waiting on a pipeline, and the fix is a settle, never a larger number. */
export const ROW_VISIBILITY_BUDGET_MS = 15_000;

/** The instant-render budget for optimistic UI. dispatch-order-immediate-
 *  visibility.spec.ts owns this invariant: a create must appear WITHOUT waiting
 *  for the projection, and it asserts elapsedMs <= this value, so the number is
 *  the assertion rather than a safety margin.
 *
 *  Deliberately separate from ROW_VISIBILITY_BUDGET_MS. Sharing one constant
 *  would mean any future raise of the generous budget silently destroys the
 *  invariant this one exists to prove -- the optimistic row would be allowed to
 *  take fifteen seconds and the spec would still pass. */
export const OPTIMISTIC_RENDER_BUDGET_MS = 500;
