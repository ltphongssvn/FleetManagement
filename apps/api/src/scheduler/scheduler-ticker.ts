// apps/api/src/scheduler/scheduler-ticker.ts
// Registry contract for the self-scheduling background ticks the
// SchedulerService drives (outbox relay, projection runner, commands
// reconciler, and the optional lag monitors / self-healing reconcilers).
//
// ROOT-CAUSE FIX (scheduler-multiprovider-registry): every previous monitor
// added a member to a SchedulerKind union AND a case to FIVE parallel switch
// statements (scheduleNext / tagFor / labelFor / invokeDrain) AND a private
// timer field AND a public drain method -- five+ edit sites per monitor, all
// on shared lines. Two monitors landing in parallel worktrees collided on
// exactly those lines (a live three-way merge conflict on develop). The 2026
// remedy (NestJS #4786 multi-provider injection) is to make each tick a
// self-describing value: the service drives an injected SchedulerTicker[] with
// ONE loop and ONE timer map, so a new tick is one new value in the module
// factory and touches ZERO shared lines in the service.
//
// This is an internal DI contract -- it crosses no trust boundary and is not
// duplicated across packages -- so it is a plain TypeScript interface, not a
// Zod schema (schema-first two-axis rule: do not force Zod onto internal-only,
// non-duplicated shapes).

// DI token for the assembled ticker list. The module useFactory gathers the
// core ticks plus every injected-and-enabled monitor into this array.
export const SCHEDULER_TICKERS = 'SCHEDULER_TICKERS' as const;

export interface SchedulerTicker {
  // Stable identity for this tick. Used as the timer-map key and by the
  // back-compat drainByKey() lookup. Unique across the registry.
  readonly key: string;
  // Sentry job tag (scope.setTag('job', tag)) for breadcrumb isolation.
  readonly tag: string;
  // Human error-log prefix when a tick throws (e.g. 'Outbox drain failed: ').
  readonly label: string;
  // Self-scheduling cadence in milliseconds; the next tick is armed only after
  // the current run settles (no overlap).
  readonly intervalMs: number;
  // The unit of work. May be sync (commands reconciler) or async (everything
  // else); the runner awaits completion and discards any return value -- a
  // reconciler that returns a result summary is fine, the scheduler ignores it
  // and only cares whether the tick settled or threw.
  run(): unknown;
}
