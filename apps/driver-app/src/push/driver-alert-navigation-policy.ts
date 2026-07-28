// apps/driver-app/src/push/driver-alert-navigation-policy.ts
// S5g (T12 driver-order-alerts): PURE tap-navigation policy. When the driver
// taps the alert, the notification data payload -> the screen to open.
//
// TRUST BOUNDARY: the payload is attacker-shaped input. Anyone who can reach
// the device push channel can deliver arbitrary JSON, so it is safeParsed
// against the shared DriverAlertPushDataSchema (the same SSOT the api sender
// derives from) before any navigation is built. The schema is .strict(), so
// an envelope-key leak (e.g. assignedOperatorId, the server-side address that
// must never reach the phone) is REJECTED, not silently tolerated.
//
// Fail-safe, never fail-open: any parse failure degrades to the assignments
// list -- the screen that always shows the driver their real orders -- rather
// than throwing into the tap handler or navigating to a half-built href. A
// missed tap that still lands on the orders list costs a few seconds; a throw
// or a broken href costs the run.
//
// The return is a discriminated union so a caller cannot forget the fallback
// branch: an untyped string return would let a bad payload slip through as a
// navigable href. Mirrors capture-href.ts -- pure, unit-tested directly; the
// native listener + router.push live in _layout behind the wiring guard.
import { DriverAlertPushDataSchema } from '@fleet/sync-protocol';

export const DRIVER_ALERT_NAV_POLICY_VERSION = 'driver-alert-nav-v1' as const;

/** The assignments list: the always-safe destination. A tap that cannot be
 *  resolved to a specific order still puts the driver in front of their real
 *  orders. */
const ASSIGNMENTS_FALLBACK_HREF = '/assignments' as const;

export type DriverAlertNavDecision =
  | { readonly action: 'navigate'; readonly href: string; readonly policyVersion: typeof DRIVER_ALERT_NAV_POLICY_VERSION }
  | { readonly action: 'fallback'; readonly href: typeof ASSIGNMENTS_FALLBACK_HREF; readonly policyVersion: typeof DRIVER_ALERT_NAV_POLICY_VERSION };

/** Parse the untrusted notification data payload and decide where to go.
 *  Total function: every non-conforming input resolves to fallback. */
export function decideDriverAlertNavigation(rawData: unknown): DriverAlertNavDecision {
  const parsed = DriverAlertPushDataSchema.safeParse(rawData);
  if (!parsed.success) {
    return { action: 'fallback', href: ASSIGNMENTS_FALLBACK_HREF, policyVersion: DRIVER_ALERT_NAV_POLICY_VERSION };
  }
  const data = parsed.data;
  // encodeURIComponent every value: order refs are dotted/slashed (XTT.07-001,
  // and hand-entered refs can carry spaces or slashes), any of which would
  // corrupt a raw query string.
  const href =
    ASSIGNMENTS_FALLBACK_HREF +
    '?roadRunId=' + encodeURIComponent(data.roadRunId) +
    '&externalRef=' + encodeURIComponent(data.externalRef);
  return { action: 'navigate', href, policyVersion: DRIVER_ALERT_NAV_POLICY_VERSION };
}
