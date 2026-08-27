// apps/ops-web/test/use-refetch-on-focus.test.tsx
// RED-FIRST L1 (2026): the single reusable refetch-on-focus hook. Every
// user-facing surface that displays shared, externally-mutable server state
// (dispatch board, order review, driver/vehicle admin, reference admin) must
// refetch when the tab regains focus, so a change made elsewhere (another
// dispatcher / device / tab) appears without a manual reload. To keep that
// behavior DRY and consistent (SRP / single source of truth), the listener
// wiring lives in ONE hook, useRefetchOnFocus(onFocus), used by all surfaces.
//
// The hook is presentation-only: it takes a caller-supplied callback and wires
// browser focus/visibility events to it. It introduces NO data shape, so it
// cannot drift from the @fleet/domain typed contracts. Callers pass either
// () => router.refresh() (RSC-backed surfaces) or their own client refetch fn
// (client-state surfaces like the admin pages).
//
// Safety contract asserted here (matches TanStack focusManager 2026):
//   * fires on document visibilitychange -> 'visible'
//   * fires on window 'focus'
//   * does NOT fire when the tab goes hidden
//   * removes BOTH listeners on unmount (no leak, converges)
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { JSX } from 'react';

afterEach(cleanup);

import { useRefetchOnFocus } from '../src/lib/use-refetch-on-focus';

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

function Harness({ onFocus }: { onFocus: () => void }): JSX.Element {
  useRefetchOnFocus(onFocus);
  return <div data-testid="harness" />;
}

describe('useRefetchOnFocus', () => {
  it('calls onFocus when the tab becomes visible again (visibilitychange -> visible)', () => {
    setVisibility('visible');
    const onFocus = vi.fn();
    render(<Harness onFocus={onFocus} />);
    onFocus.mockClear(); // mount must not count

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(
      onFocus.mock.calls.length,
      'onFocus must fire when the tab returns to visible',
    ).toBeGreaterThanOrEqual(1);
  });

  it('calls onFocus on window focus', () => {
    setVisibility('visible');
    const onFocus = vi.fn();
    render(<Harness onFocus={onFocus} />);
    onFocus.mockClear();

    window.dispatchEvent(new Event('focus'));

    expect(
      onFocus.mock.calls.length,
      'onFocus must fire when the window regains focus',
    ).toBeGreaterThanOrEqual(1);
  });

  it('does NOT call onFocus when the tab goes hidden', () => {
    setVisibility('visible');
    const onFocus = vi.fn();
    render(<Harness onFocus={onFocus} />);
    onFocus.mockClear();

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(onFocus.mock.calls.length, 'hidden must not refetch').toBe(0);
  });

  it('removes both listeners on unmount (no fire after unmount)', () => {
    setVisibility('visible');
    const onFocus = vi.fn();
    const { unmount } = render(<Harness onFocus={onFocus} />);
    unmount();
    onFocus.mockClear();

    // After unmount, neither event may reach the callback.
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));

    expect(onFocus.mock.calls.length, 'no listener may survive unmount').toBe(0);
  });
});
