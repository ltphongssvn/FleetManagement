// e2e/helpers/create-order.ts
// Shared helpers for the dispatch board and its create-order drawer.
//
// Two DISTINCT readiness questions the suite kept conflating:
//
//   1. Is the BOARD interactive? (rows clickable, filters live, export ready)
//   2. Is the CREATE FORM open and interactive?
//
// Before T38 both were answered by the same assertion, because the create form
// rendered at page load and carried the only data-hydrated marker. T38 moved the
// form behind a drawer, so that single answer became wrong in both directions:
// board-only specs could no longer find the form, and once a helper opened the
// drawer for them, the drawer covered the board they were trying to click.
//
// The board root now carries its own data-hydrated signal, so the two questions
// have two answers. Use waitForBoardReady for anything that reads or clicks the
// table; use openCreateOrderDrawer only when the spec actually creates an order.
// scripts/e2e-create-drawer-selectors.guard.test.ts keeps both contracts honest.
import { expect, type Locator, type Page } from '@playwright/test';

const BOARD = '[data-testid=dispatch-board][data-hydrated=true]';
const FORM = '[data-testid=nl-create-order-form][data-hydrated=true]';
const OPEN_BUTTON = 'open-create-order';
const CLOSE_BUTTON = 'close-create-order';

// Question 1: the board is rendered AND hydrated, with no drawer over it.
// Returns the board locator so row queries can be scoped to it.
export async function waitForBoardReady(page: Page, timeout = 15_000): Promise<Locator> {
  const board = page.locator(BOARD);
  await expect(board).toBeVisible({ timeout });
  return board;
}

// Question 2: the drawer is open and its form is hydrated. Idempotent -- a second
// call resolves against the already-mounted form instead of clicking again. The
// board must be ready first, or the click lands before the button is interactive.
export async function openCreateOrderDrawer(page: Page, timeout = 15_000): Promise<Locator> {
  await waitForBoardReady(page, timeout);
  const form = page.locator(FORM);
  if ((await form.count()) === 0) {
    await page.getByTestId(OPEN_BUTTON).click();
  }
  await expect(form).toBeVisible({ timeout });
  return form;
}

// The dispatch-date field. T38 dropped every id from the re-laid-out form; the
// ids are restored at source, but scoping to the form locator is still correct
// so a board cell can never satisfy a form-field assertion.
export function plannedStartAtField(form: Locator): Locator {
  return form.locator('input[name=plannedStartAt]');
}

export async function openCreateOrderDrawerWithDate(page: Page, isoDate: string): Promise<Locator> {
  const form = await openCreateOrderDrawer(page);
  await plannedStartAtField(form).fill(isoDate);
  return form;
}

// Closes the drawer and waits for it to UNMOUNT, so a following board click can
// never race the closing animation. Headless UI Dialog removes the panel on
// close, which is what makes this assertion meaningful.
export async function closeCreateOrderDrawer(page: Page): Promise<void> {
  await page.getByTestId(CLOSE_BUTTON).click();
  await expect(page.locator(FORM)).toHaveCount(0);
}
