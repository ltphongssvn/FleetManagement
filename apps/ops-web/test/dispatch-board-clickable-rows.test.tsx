// apps/ops-web/test/dispatch-board-clickable-rows.test.tsx
// L1 RED for T5: each dispatch board row's Số lệnh cell must be a
// navigable link to /dispatch/orders/{externalRef}. This is the
// production UI gap exposed by the PDF: the L0 Playwright cancel spec
// navigated by direct URL but a real dispatcher had no way to open the
// review page from the board. Making the Số lệnh cell a Next.js Link is
// the smallest UI surface that closes the gap.
//
// Visibility rule: a row is only navigable if it has at least one
// transportOrderRef (the human-readable XT.NNNN). Rows whose
// transportOrderRefs is empty render the em-dash and are NOT linked.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
afterEach(cleanup);
vi.mock('../src/features/dispatch/load-board.js', () => ({
  loadDispatchBoard: vi.fn().mockResolvedValue([
    {
      roadRunId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      state: 'planned',
      assignedOperatorId: null,
      assignedAssetId: null,
      plannedStartAt: '2026-04-28T08:00:00.000Z',
      stopCount: 3,
      transportOrderRefs: ['XT.001'],
    },
    {
      roadRunId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      state: 'dispatched',
      assignedOperatorId: 'op-1',
      assignedAssetId: 'truck-7',
      plannedStartAt: null,
      stopCount: 2,
      transportOrderRefs: [],
    },
  ]),
}));
const { DispatchBoard } = await import('../src/features/dispatch/DispatchBoard.js');
describe('DispatchBoard - clickable row navigation (T5)', () => {
  it('wraps the Số lệnh cell in a link to /dispatch/orders/{externalRef}', async () => {
    render(await DispatchBoard());
    const link = screen.getByRole('link', { name: /XT\.001/ });
    expect(link.getAttribute('href')).toBe('/dispatch/orders/XT.001');
  });
  it('exposes a data-testid hook so the L0 Playwright spec can click the row', async () => {
    render(await DispatchBoard());
    const cell = screen.getByTestId('dispatch-board-row-XT.001');
    expect(cell).toBeTruthy();
  });
  it('does NOT render a link when the row has no transportOrderRefs (em-dash placeholder)', async () => {
    render(await DispatchBoard());
    const links = screen.queryAllByRole('link');
    // Only the XT.001 link should exist (the empty-ref row falls back to em-dash text).
    const orderLinks = links.filter((l) => (l.getAttribute('href') ?? '').startsWith('/dispatch/orders/'));
    expect(orderLinks.length).toBe(1);
  });
});
