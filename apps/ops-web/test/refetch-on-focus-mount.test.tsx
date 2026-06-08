// apps/ops-web/test/refetch-on-focus-mount.test.tsx
// RED-FIRST L1 (2026): a tiny client component that activates refetch-on-focus
// inside a Server Component page. The order-review page (Chi tiết đơn vận chuyển)
// is an RSC that fetches the order server-side; it cannot call hooks itself. This
// mount component lets that RSC participate in the professional refetch-on-focus
// default: on visibilitychange->visible / window focus it calls router.refresh(),
// which re-runs the RSC server-side and re-fetches the order — so an externally
// driven state change (another dispatcher cancels it, or the driver completes
// stops) updates the review WITHOUT a manual reload.
//
// It renders nothing (presentational no-op) and delegates the event wiring to the
// shared useRefetchOnFocus hook (single source of truth). No data shape.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: (): { refresh: () => void } => ({ refresh: refreshMock }),
}));

import { RefetchOnFocusMount } from '../src/features/shell/RefetchOnFocusMount';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

describe('RefetchOnFocusMount', () => {
  it('renders nothing', () => {
    const { container } = render(<RefetchOnFocusMount />);
    expect(container.innerHTML).toBe('');
  });

  it('calls router.refresh() when the tab becomes visible again', () => {
    setVisibility('visible');
    render(<RefetchOnFocusMount />);
    refreshMock.mockClear();

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(
      refreshMock.mock.calls.length,
      'router.refresh() must fire when the tab returns to visible',
    ).toBeGreaterThanOrEqual(1);
  });

  it('calls router.refresh() on window focus', () => {
    setVisibility('visible');
    render(<RefetchOnFocusMount />);
    refreshMock.mockClear();

    window.dispatchEvent(new Event('focus'));

    expect(
      refreshMock.mock.calls.length,
      'router.refresh() must fire on window focus',
    ).toBeGreaterThanOrEqual(1);
  });
});
