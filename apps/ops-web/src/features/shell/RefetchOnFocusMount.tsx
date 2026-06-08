// apps/ops-web/src/features/shell/RefetchOnFocusMount.tsx
// Tiny client component that activates refetch-on-focus inside a Server
// Component page. RSC pages (e.g. the order-review page Chi tiết đơn vận chuyển)
// fetch data server-side and cannot call hooks; mounting this component lets
// them participate in the 2026 professional refetch-on-focus default. On
// visibilitychange->visible / window focus it calls router.refresh(), which
// re-runs the RSC server-side and re-fetches its data — so an externally driven
// change (another dispatcher cancels the order, or the driver completes stops)
// updates the view WITHOUT a manual reload. router.refresh() merges the RSC
// payload, preserving client state, unlike location.reload().
//
// Renders nothing. Delegates the event wiring to the shared useRefetchOnFocus
// hook (single source of truth). Presentation-only: introduces no data shape.
'use client';
import { useRouter } from 'next/navigation';
import { useRefetchOnFocus } from '../../lib/use-refetch-on-focus';

export function RefetchOnFocusMount(): null {
  const router = useRouter();
  useRefetchOnFocus(() => { router.refresh(); });
  return null;
}
