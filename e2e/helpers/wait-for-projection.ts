// e2e/helpers/wait-for-projection.ts
// DOMAIN ACTION: after creating an order through the UI, make the dispatch
// board actually show the SERVER's row, then hand control back to the spec.
//
// ROOT CAUSE THIS ELIMINATES -- two hops, both asynchronous, neither waited on.
//
// 1. WRITE -> READ MODEL. The create returns when the write side commits: the
//    success banner carries the server-assigned XTT ref while the row still has
//    to travel outbox -> relay -> BullMQ -> projection runner. Specs asserted
//    straight onto the board against a fixed 15s locator budget, racing an
//    async pipeline with a stopwatch. Auto-waiting cannot rescue that: the DOM
//    is present and settled, it simply lacks the row.
//
// 2. READ MODEL -> THIS PAGE. DispatchView renders a create instantly from
//    useOptimistic, but that optimistic row is built from the action RESULT --
//    externalRef only -- so it carries no customerName, driverName or plate.
//    The real row arrives via a single router.refresh() fired the moment the
//    action returns, which is precisely when the projection has NOT caught up
//    yet. There is no second attempt, so the page keeps a render taken before
//    the row existed. Specs asserting on a server-derived field therefore
//    failed while specs asserting on externalRef alone passed -- exactly the
//    split observed between dispatch-order-immediate-visibility (green at a
//    500ms budget) and the khachhang specs (red at 15s).
//
// WHY ONE HELPER AND NOT TWO STEPS PER SPEC. Six spec files each declared their
// own ROW_VISIBILITY_BUDGET_MS = 15_000, which is why a July budget raise on
// one spec healed nothing. Copying a wait plus a reload into each caller would
// rebuild that same duplication. 2026 practice separates responsibilities:
// fixtures for setup, page objects for page behavior, HELPERS FOR DOMAIN
// ACTIONS. This is a domain action -- one shallow, named function, no helper
// chains, so a reader sees the whole story in one file.
//
// POLLS THE PUBLIC ENDPOINT, NOT THE TABLE. An earlier draft queried
// dispatch_board_projection over dockerPsql and had to reimplement the read
// path by hand: company scoping, deleted_at IS NULL, and the jsonb semantics of
// transport_order_refs -- which the projection runner copies verbatim from the
// event delta, so the column's meaning is not decidable from the schema alone.
// Needing that archaeology is the signal it was the wrong boundary. GET
// /dispatch/board is what load-board.ts fetches, so a pass here means the board
// WILL render the row; the API already applies scoping and tombstone filters.
// The response is validated with DispatchBoardResponseSchema from
// @fleet/sync-protocol, the canonical contract the API and ops-web both parse.
//
// NOT a sleep and NOT a budget raise: if the row never arrives this fails
// naming the ref it waited for, blaming the pipeline rather than surfacing as a
// missing-cell mystery two hundred lines away.
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { DispatchBoardResponseSchema } from '@fleet/sync-protocol';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';

/** Budget for the write-to-read-model hop. Generous because it bounds a
 *  multi-hop async pipeline under parallel-worktree load; a poll that succeeds
 *  early costs only the first interval. */
export const PROJECTION_MATERIALIZE_TIMEOUT_MS = 30_000;

/** Tight at first so the common case returns in ~250ms, then backing off so a
 *  slow relay does not hammer the API. */
const POLL_INTERVALS_MS = [250, 250, 500, 500, 1000, 1000, 2000];

/** Does the board endpoint currently carry this ref? Returns false rather than
 *  throwing on a transport or shape failure so the poll keeps retrying: during
 *  the window this covers, a transient non-200 is normal. */
export async function boardCarriesRef(
  api: APIRequestContext,
  token: string,
  externalRef: string,
): Promise<boolean> {
  const res = await api.get(API_URL + '/dispatch/board', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok()) return false;
  const parsed = DispatchBoardResponseSchema.safeParse(await res.json());
  if (!parsed.success) return false;
  return parsed.data.rows.some((row) => row.transportOrderRefs.includes(externalRef));
}

/** Block until the board endpoint carries externalRef. Exported for specs that
 *  need the readiness fact WITHOUT re-rendering the page. */
export async function waitForProjectionRow(
  api: APIRequestContext,
  token: string,
  externalRef: string,
): Promise<void> {
  if (externalRef.length === 0) {
    throw new Error('waitForProjectionRow: externalRef must not be empty');
  }
  await expect
    .poll(() => boardCarriesRef(api, token, externalRef), {
      message:
        'order ' +
        externalRef +
        ' never reached GET /dispatch/board: the outbox -> relay -> BullMQ -> ' +
        'projection pipeline did not materialize a visible row',
      intervals: POLL_INTERVALS_MS,
      timeout: PROJECTION_MATERIALIZE_TIMEOUT_MS,
    })
    .toBe(true);
}

/** THE DOMAIN ACTION specs should call. Wait for the read model, then re-render
 *  this page from it. Call AFTER capturing the ref from the create banner and
 *  BEFORE asserting any SERVER-DERIVED field (customer, driver, plate, weight).
 *  Specs asserting only on externalRef do not need it -- the optimistic row
 *  already carries that, and dispatch-order-immediate-visibility.spec.ts owns
 *  that separate instant-render invariant. */
export async function settleBoardAfterCreate(
  page: Page,
  api: APIRequestContext,
  token: string,
  externalRef: string,
): Promise<void> {
  await waitForProjectionRow(api, token, externalRef);
  // The page holds a render taken before the row existed, and the app fires no
  // second refresh. With readiness now established this reload is deterministic
  // rather than another roll of the dice.
  await page.reload();
}
