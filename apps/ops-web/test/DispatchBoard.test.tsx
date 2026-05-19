// apps/ops-web/test/DispatchBoard.test.tsx
// RSC component test: render with mocked load-board.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

afterEach(cleanup);

vi.mock('../src/features/dispatch/load-board.js', () => ({
  loadDispatchBoard: vi.fn().mockResolvedValue([
    {
      roadRunId: '11111111-1111-4111-8111-111111111111',
      state: 'planned',
      assignedOperatorId: null,
      assignedAssetId: null,
      plannedStartAt: '2026-04-28T08:00:00.000Z',
      stopCount: 3,
      transportOrderRefs: ['TO-1001', 'TO-1002'],
    },
    {
      roadRunId: '22222222-2222-4222-8222-222222222222',
      state: 'dispatched',
      assignedOperatorId: 'op-1',
      assignedAssetId: 'truck-7',
      plannedStartAt: null,
      stopCount: 2,
      transportOrderRefs: ['TO-1003'],
    },
  ]),
}));

const { DispatchBoard } = await import('../src/features/dispatch/DispatchBoard.js');

describe('@fleet/ops-web - DispatchBoard (RSC)', () => {
  it('renders heading', async () => {
    render(await DispatchBoard());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Lệnh điều xe');
  });

  it('renders one row per road run', async () => {
    render(await DispatchBoard());
    const rows = screen.getAllByRole('row');
    // 1 header + 2 data rows
    expect(rows.length).toBe(3);
  });

  it('renders state badges for each row', async () => {
    render(await DispatchBoard());
    expect(screen.getByText('planned')).toBeInTheDocument();
    expect(screen.getByText('dispatched')).toBeInTheDocument();
  });

  it('renders transport order refs', async () => {
    render(await DispatchBoard());
    expect(screen.getByText(/TO-1001/)).toBeInTheDocument();
    expect(screen.getByText(/TO-1003/)).toBeInTheDocument();
  });

  it('renders em-dash for unassigned operator', async () => {
    render(await DispatchBoard());
    const cells = screen.getAllByText('—');
    expect(cells.length).toBeGreaterThan(0);
  });
});

describe('@fleet/ops-web - DispatchBoard empty state', () => {
  it('renders empty message when no runs are loaded', async () => {
    vi.resetModules();
    vi.doMock('../src/features/dispatch/load-board.js', () => ({
      loadDispatchBoard: vi.fn().mockResolvedValue([]),
    }));
    const mod = await import('../src/features/dispatch/DispatchBoard.js');
    render(await mod.DispatchBoard());
    expect(screen.getByText(/Chưa có lệnh điều xe/)).toBeInTheDocument();
  });
});
