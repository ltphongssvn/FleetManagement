// apps/driver-app/test/notification-boot-wiring.test.ts
// S5-wire (T12 driver-order-alerts) -- outside-in strict TDD, wiring guard.
//
// The pure policies (S5a setup, S5g tap-nav) and the native adapter (S5d)
// all exist and are green -- but nothing CALLS them. Until the root layout
// wires boot-time setup and the tap-response handling, the adapter is never
// invoked and the phone stays silent. This slice pins that wiring.
//
// ROOT-CAUSE PATTERN (Expo docs, 2026-05): addNotificationResponseReceived-
// Listener ALONE does NOT catch a COLD-START tap. When the app is killed and
// launched BY tapping the notification -- the exact 4AM case: phone off all
// night, driver taps the alert -- the listener never fires (it only fires if
// the app was already foreground/background). Expo requires ALSO draining
// getLastNotificationResponseAsync() on startup. Wiring ONLY the listener
// would make the single most important tap in the whole feature silently open
// the default screen instead of the order. So the guard demands BOTH paths,
// both routed through the already-tested decideDriverAlertNavigation policy.
//
// Why the ROOT layout (app/_layout.tsx), not the authed (app)/_layout.tsx:
// the channel + tap handling must exist from the very first launch, before
// the auth gate, or a cold logged-out tap has no channel to ring through and
// no handler to route it. Boot setup is unconditional, above AuthProvider.
//
// SOURCE-CONTRACT guard (same trade as capture-auto-advance-wiring.test.ts):
// _layout.tsx renders real native modules and is coverage-excluded, so we
// assert what the source MUST say. The behaviour it wires is already unit-
// tested: decideDriverAlertNavigation (11 cases) + runNotificationSetup.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(resolve(here, '..', rel), 'utf8');

const LAYOUT = 'app/_layout.tsx';

describe('@fleet/driver-app - notification boot wiring (root layout)', () => {
  it('imports the native alert setup entrypoint from the coverage-excluded adapter', () => {
    const s = src(LAYOUT);
    expect(s.includes('setUpDriverAlerts'), 'the root layout must call the native bring-up on boot').toBe(true);
    expect(s.includes('notification-setup-native'), 'the native entrypoints come from the coverage-excluded adapter, imported directly like startNativeSyncLoop').toBe(true);
  });

  it('invokes boot setup fire-and-forget (never awaited into render)', () => {
    const s = src(LAYOUT);
    expect(s.includes('void setUpDriverAlerts('), 'boot setup is fire-and-forget: a slow/denied permission prompt must never block the first paint').toBe(true);
  });

  it('wires tap handling through the named adapter entrypoints (decision policy lives in the excluded adapter)', () => {
    const s = src(LAYOUT);
    expect(s.includes('subscribeNotificationTaps') && s.includes('drainInitialNotificationResponse'), 'the layout wires the named wrappers; the raw expo API + decideDriverAlertNavigation routing live in notification-setup-native.ts (guarded by its own wiring test)').toBe(true);
  });

  it('wires the live-tap subscription (fg/bg) via subscribeNotificationTaps', () => {
    const s = src(LAYOUT);
    expect(s.includes('subscribeNotificationTaps('), 'a tap while foreground/background must be handled by the response-listener wrapper').toBe(true);
  });

  it('ALSO wires the cold-start drain on boot (killed app launched by tap)', () => {
    const s = src(LAYOUT);
    expect(s.includes('drainInitialNotificationResponse('), 'the listener alone misses a cold-start tap; the boot drain wrapper (getLastNotificationResponseAsync inside the adapter) must be wired or a 4AM tap from a killed app opens the wrong screen').toBe(true);
  });

  it('supplies router.push as the navigate edge to both tap paths', () => {
    const s = src(LAYOUT);
    expect(s.includes('router.push'), 'the layout injects router.push as the navigate function both wrappers call on a navigate decision').toBe(true);
  });

  it('removes the response subscription on cleanup (no leak across fast-refresh)', () => {
    const s = src(LAYOUT);
    expect(s.includes('.remove()'), 'the response subscription must be removed on effect cleanup').toBe(true);
  });

  it('subscribes the live listener BEFORE draining the cold-start response', () => {
    const s = src(LAYOUT);
    const subIdx = s.indexOf('subscribeNotificationTaps(');
    const drainIdx = s.indexOf('drainInitialNotificationResponse(');
    expect(subIdx, 'the subscribe call must be present').toBeGreaterThan(-1);
    expect(drainIdx, 'the drain call must be present').toBeGreaterThan(-1);
    expect(subIdx, 'Expo only reliably returns the last response once a response listener exists (expo/expo#36930,#37511), so subscribe must precede drain').toBeLessThan(drainIdx);
  });

  it('keeps the fetch polyfill import first (regression guard on existing invariant)', () => {
    const s = src(LAYOUT);
    const firstImportLine = s.split(String.fromCharCode(10)).find((l) => l.trimStart().startsWith('import '));
    expect(firstImportLine, 'an import must exist').toBeDefined();
    expect((firstImportLine ?? '').includes('install-fetch-polyfill'), 'the fetch polyfill must remain the very first import (RN 0.83 Bridgeless fix); alert wiring must not displace it').toBe(true);
  });

  it('is coverage-excluded (app/ native shell is not unit-runnable)', () => {
    const cfg = src('vitest.config.ts');
    expect(cfg.includes('app/'), 'the app/ router shell renders native modules and must be outside the coverage include set').toBe(true);
  });
});
