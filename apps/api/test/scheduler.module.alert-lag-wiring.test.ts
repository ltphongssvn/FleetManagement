// apps/api/test/scheduler.module.alert-lag-wiring.test.ts
// S6c (T12 driver-order-alerts) -- wiring guard for the alert-lag monitor DI.
// The pure monitor (S6a), the repo (S6b), and the scheduler tick are all green,
// but they only page in production if the module actually PROVIDES the monitor
// against the ALERT_LAG_MONITOR token and the DRIVER_ALERT_LAG_MINUTES knob
// exists to threshold it. A future refactor that drops either would make the
// guard silently dormant -- the exact silent-failure class S6 exists to kill.
// Source-contract guard (module DI is heavy to boot in a unit test; a source
// scan is the proportionate lock, same trade as the notification wiring guard).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(resolve(here, '..', rel), 'utf8');

describe('@fleet/api - alert-lag monitor DI wiring', () => {
  it('the scheduler module registers the DrizzleAlertLagRepo provider', () => {
    const s = src('src/scheduler/scheduler.module.ts');
    expect(s.includes('DrizzleAlertLagRepo'), 'the repo must be a provider so the monitor factory can inject it').toBe(true);
  });

  it('the scheduler module provides the ALERT_LAG_MONITOR against its token', () => {
    const s = src('src/scheduler/scheduler.module.ts');
    expect(s.includes('provide: ALERT_LAG_MONITOR'), 'the monitor must be provided against the token the scheduler injects').toBe(true);
    expect(s.includes('new AlertLagMonitorService('), 'the factory must construct the monitor').toBe(true);
  });

  it('the monitor is thresholded by the DRIVER_ALERT_LAG_MINUTES env knob', () => {
    const mod = src('src/scheduler/scheduler.module.ts');
    expect(mod.includes('DRIVER_ALERT_LAG_MINUTES'), 'the factory must read the threshold from config').toBe(true);
    const env = src('src/config/env.config.ts');
    expect(env.includes('DRIVER_ALERT_LAG_MINUTES'), 'the knob must be declared in the validated env schema').toBe(true);
  });

  it('the always-on monitor has no dormancy secret (unlike break-glass)', () => {
    const s = src('src/scheduler/scheduler.module.ts');
    // The factory return type must be the concrete service, never nullable:
    // alert-lag needs only DB + Sentry, so it is unconditionally active.
    expect(s.includes('): AlertLagMonitorService =>'), 'the factory must return a non-null monitor (always on)').toBe(true);
  });
});
