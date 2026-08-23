// apps/ops-web/test/copilot-command-palette-session-expired.test.tsx
// RED (T11 idle-timeout arc, P7 sweep): a 401 in the palette means the whole
// session is dead (the BFF forwarder already exhausted mint-on-miss) -- an
// in-place message strands the dispatcher, since every next action 401s
// again. Both handlers (plan + execute) must hand the browser to the
// silent-refresh navigation instead. Non-401 failures keep the in-place
// friendly copy (pinned by the existing suite). Partial mock: only the
// navigation side-effect is stubbed (house lesson).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import type * as SessionRefreshNavigation from '@/features/auth/session-refresh-navigation';
const { navigateToSessionRefreshMock } = vi.hoisted(() => ({
  navigateToSessionRefreshMock: vi.fn(),
}));
vi.mock('@/features/auth/session-refresh-navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionRefreshNavigation>();
  return { ...actual, navigateToSessionRefresh: navigateToSessionRefreshMock };
});
import { CommandPalette } from '../src/features/copilot/command-palette';

const PLAN = {
  planId: 'a3bb189e-8bf9-4888-9912-ace4e6543002',
  summaryVi: 'Se tao ten hang Gao',
  commands: [
    { type: 'create_cargo_type', commandId: 'b4cc290f-9c0a-4999-aa23-bdf5f7654113', name: 'Gao' },
  ],
};

function problemRes(status: number, code: string): Response {
  return new Response(JSON.stringify({ type: 'about:blank', title: 'x', status, code }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

function jsonRes(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function openPalette(): void {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
}

function submitText(value: string): void {
  fireEvent.change(screen.getByPlaceholderText('Nhập lệnh...'), { target: { value } });
  fireEvent.submit(screen.getByRole('form', { name: 'copilot' }));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('CommandPalette on idle-expired session (401)', () => {
  it('plan 401 -> silent-refresh navigation, no stranded in-place message', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(problemRes(401, 'UNAUTHORIZED')));
    render(<CommandPalette fetchFn={fetchFn as never} />);
    openPalette();
    submitText('Them ten hang Gao');
    await waitFor(() => {
      expect(navigateToSessionRefreshMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('execute 401 -> silent-refresh navigation', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ kind: 'plan', plan: PLAN }))
      .mockResolvedValueOnce(problemRes(401, 'UNAUTHORIZED'));
    render(<CommandPalette fetchFn={fetchFn as never} />);
    openPalette();
    submitText('Them ten hang Gao');
    await waitFor(() => screen.getByRole('button', { name: 'Xác nhận' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => {
      expect(navigateToSessionRefreshMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('non-401 failures never navigate (existing in-place copy keeps working)', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(problemRes(500, 'INTERNAL')));
    render(<CommandPalette fetchFn={fetchFn as never} />);
    openPalette();
    submitText('x');
    await screen.findByText('Hệ thống đang gặp sự cố. Vui lòng thử lại sau.');
    expect(navigateToSessionRefreshMock).not.toHaveBeenCalled();
  });
});
