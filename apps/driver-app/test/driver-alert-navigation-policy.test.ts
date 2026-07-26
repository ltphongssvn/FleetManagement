// apps/driver-app/test/driver-alert-navigation-policy.test.ts
// S5g (T12 driver-order-alerts) -- outside-in strict TDD, RED first.
//
// When the driver TAPS the alert, the app must open the right screen. The
// notification data payload crosses a TRUST BOUNDARY: it is attacker-shaped
// input (anyone who can reach the device push channel can deliver arbitrary
// JSON), so it is safeParsed against DriverAlertPushDataSchema before any
// navigation. A malformed payload must NEVER throw into the tap handler and
// must NEVER navigate to a half-built href -- it degrades to the assignments
// list, the safe default that always shows the driver their real orders.
//
// This is the PURE half of tap-handling: payload -> decision. The native
// half (addNotificationResponseReceivedListener + router.push) is wired in
// _layout under the existing wiring-guard pattern and is coverage-excluded.
//
// Design mirrors capture-href.ts: a pure href builder, unit-tested directly.
// The decision is a discriminated union so the caller cannot forget the
// malformed branch -- an untyped string return would let a bad payload slip
// through as a navigable href.
import { describe, it, expect } from 'vitest';
import {
  decideDriverAlertNavigation,
  DRIVER_ALERT_NAV_POLICY_VERSION,
  type DriverAlertNavDecision,
} from '../src/push/driver-alert-navigation-policy.js';

const validPayload = {
  alertKind: 'transport_order_created',
  roadRunId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  externalRef: 'XTT.07-001',
};

describe('@fleet/driver-app - driver alert navigation policy', () => {
  it('exposes a policy version tag', () => {
    expect(DRIVER_ALERT_NAV_POLICY_VERSION).toBe('driver-alert-nav-v1');
  });

  it('navigates a valid transport_order_created payload to the assignments screen', () => {
    const d = decideDriverAlertNavigation(validPayload);
    expect(d.action).toBe('navigate');
    if (d.action !== 'navigate') throw new Error('expected navigate');
    expect(d.href.startsWith('/assignments'), 'the tap must open the orders list').toBe(true);
  });

  it('threads the road run id so the list can focus the new order', () => {
    const d = decideDriverAlertNavigation(validPayload);
    if (d.action !== 'navigate') throw new Error('expected navigate');
    expect(d.href).toContain('roadRunId=3f2504e0-4f89-41d3-9a0c-0305e82c3301');
  });

  it('carries the human order ref for the focused row', () => {
    const d = decideDriverAlertNavigation(validPayload);
    if (d.action !== 'navigate') throw new Error('expected navigate');
    expect(d.href).toContain('externalRef=XTT.07-001');
  });

  it('URL-encodes ref values so a dotted/slashed code cannot break the href', () => {
    const d = decideDriverAlertNavigation({ ...validPayload, externalRef: 'A/B 07' });
    if (d.action !== 'navigate') throw new Error('expected navigate');
    expect(d.href, 'a raw space or slash would corrupt the query string').not.toContain('A/B 07');
    expect(d.href).toContain('externalRef=A%2FB%2007');
  });

  it('safe-defaults to the assignments list on a NULL payload (no throw)', () => {
    const d = decideDriverAlertNavigation(null);
    expect(d.action).toBe('fallback');
    if (d.action !== 'fallback') throw new Error('expected fallback');
    expect(d.href).toBe('/assignments');
  });

  it('safe-defaults on a payload missing required fields (strict schema)', () => {
    const d = decideDriverAlertNavigation({ alertKind: 'transport_order_created' });
    expect(d.action).toBe('fallback');
  });

  it('safe-defaults on an unknown alertKind (enum guard)', () => {
    const d = decideDriverAlertNavigation({ ...validPayload, alertKind: 'sms_spam' });
    expect(d.action).toBe('fallback');
  });

  it('safe-defaults on an envelope-key leak (strict rejects extra keys)', () => {
    const d = decideDriverAlertNavigation({ ...validPayload, assignedOperatorId: 'leaked' });
    expect(d.action).toBe('fallback');
  });

  it('never throws on hostile input types', () => {
    const hostile: unknown[] = [undefined, 42, 'string', [], { roadRunId: 123 }];
    for (const h of hostile) {
      expect(() => decideDriverAlertNavigation(h)).not.toThrow();
    }
  });

  it('returns a discriminated union the caller cannot mis-handle', () => {
    const d: DriverAlertNavDecision = decideDriverAlertNavigation(validPayload);
    expect(['navigate', 'fallback']).toContain(d.action);
  });
});
