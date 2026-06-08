// apps/ops-web/src/lib/use-refetch-on-focus.ts
// Single reusable refetch-on-focus hook (DRY / SRP single source of truth).
//
// The 2026 professional default for stale-backgrounded tabs: when a user
// returns to a tab that was backgrounded while data changed elsewhere
// (another dispatcher, another device, another tab), re-pull the server data
// so the UI reflects current state without a manual reload. The canonical
// trigger (TanStack focusManager) listens to BOTH document
// visibilitychange->'visible' AND window 'focus', and removes both listeners
// on teardown.
//
// This hook owns ONLY the event wiring; the caller supplies what to refetch:
//   - RSC-backed surfaces (dispatch board, order review) pass
//     () => router.refresh() (re-pulls the RSC payload, merges without nuking
//     client state — unlike location.reload()).
//   - Client-state surfaces (driver/vehicle admin, reference admin) pass their
//     own refetch fn (re-runs client.list() into local React state).
//
// It is presentation-only and introduces NO data shape, so it can never drift
// from the @fleet/domain typed contracts. It fires solely on visible/focus
// (never on hidden, never on mount), and removes both listeners on unmount, so
// it converges and cannot drive a render loop.
import { useEffect } from 'react';

export function useRefetchOnFocus(onFocus: () => void): void {
  useEffect(() => {
    const refetchIfVisible = (): void => {
      if (document.visibilityState === 'visible') onFocus();
    };
    document.addEventListener('visibilitychange', refetchIfVisible);
    window.addEventListener('focus', refetchIfVisible);
    return () => {
      document.removeEventListener('visibilitychange', refetchIfVisible);
      window.removeEventListener('focus', refetchIfVisible);
    };
  }, [onFocus]);
}
