// apps/api/test/helpers/scheduler-ticker-factory.ts
// Test helper mirroring the SCHEDULER_TICKERS module factory: builds the exact
// ticker values the module assembles, so a per-monitor test can assert its
// tick key / tag / interval / run-target without booting the whole Nest module.
// Kept in lockstep with scheduler.module.ts by scheduler.registry.test.ts, which
// asserts the module factory and this helper agree on the registered keys.
import type { SchedulerTicker } from '../../src/scheduler/scheduler-ticker.js';

// Cadences duplicated from scheduler.module.ts intentionally: a drift here vs
// the module is caught by the registry test that cross-checks both.
export const INTERVALS = Object.freeze({
  outbox: 5_000,
  projection: 5_000,
  reconciler: 2_000,
  intakeLag: 300_000,
  alertLag: 300_000,
  intakeReconcile: 300_000,
  completionReconcile: 300_000,
  completionMonitor: 300_000,
  breakglass: 60_000,
});

// Build a single monitor ticker exactly as the module factory does. The six
// monitor kinds differ only in key/tag/label/interval + which method they call.
export function monitorTicker(
  kind:
    | 'intakeLag'
    | 'alertLag'
    | 'intakeReconcile'
    | 'completionReconcile'
    | 'completionMonitor'
    | 'breakglass',
  run: () => unknown,
): SchedulerTicker {
  switch (kind) {
    case 'intakeLag':
      return {
        key: 'intakeLag',
        tag: 'intake-lag-check',
        label: 'Intake-lag check failed: ',
        intervalMs: INTERVALS.intakeLag,
        run,
      };
    case 'alertLag':
      return {
        key: 'alertLag',
        tag: 'driver-alert-lag-check',
        label: 'Driver-alert-lag check failed: ',
        intervalMs: INTERVALS.alertLag,
        run,
      };
    case 'intakeReconcile':
      return {
        key: 'intakeReconcile',
        tag: 'intake-reconcile',
        label: 'Intake reconcile failed: ',
        intervalMs: INTERVALS.intakeReconcile,
        run,
      };
    case 'completionReconcile':
      return {
        key: 'completionReconcile',
        tag: 'completion-reconcile',
        label: 'Completion reconcile failed: ',
        intervalMs: INTERVALS.completionReconcile,
        run,
      };
    case 'completionMonitor':
      return {
        key: 'completionMonitor',
        tag: 'completion-monitor-check',
        label: 'Completion monitor check failed: ',
        intervalMs: INTERVALS.completionMonitor,
        run,
      };
    case 'breakglass':
      return {
        key: 'breakglass',
        tag: 'breakglass-scan',
        label: 'Break-glass poll failed: ',
        intervalMs: INTERVALS.breakglass,
        run,
      };
  }
}

// The three always-on core ticks, as the module builds them.
export function coreTickers(deps: {
  outbox: () => unknown;
  projection: () => unknown;
  reconciler: () => unknown;
}): SchedulerTicker[] {
  return [
    {
      key: 'outbox',
      tag: 'outbox-drain',
      label: 'Outbox drain failed: ',
      intervalMs: INTERVALS.outbox,
      run: deps.outbox,
    },
    {
      key: 'projection',
      tag: 'projection-drain',
      label: 'Projection drain failed: ',
      intervalMs: INTERVALS.projection,
      run: deps.projection,
    },
    {
      key: 'reconciler',
      tag: 'commands-reconciler',
      label: 'Reconciler tick failed: ',
      intervalMs: INTERVALS.reconciler,
      run: deps.reconciler,
    },
  ];
}
