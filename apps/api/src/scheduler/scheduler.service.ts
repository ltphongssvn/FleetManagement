// apps/api/src/scheduler/scheduler.service.ts
// PDF Day-One: outbox relay + projection runner must drain continuously.
// Self-scheduling setTimeout prevents overlapping execution: the next tick
// fires only AFTER the current run settles. Multi-instance safety relies on
// FOR UPDATE SKIP LOCKED in outbox-relay + projection-runner.
//
// ROOT-CAUSE FIX (scheduler-multiprovider-registry, NestJS #4786): this service
// used to hard-code every tick as a SchedulerKind union member plus a case in
// four parallel switch statements, a private timer field, and a public drain
// method -- five+ shared edit sites per monitor, which produced a live
// three-way merge collision when two monitors landed in parallel. It now drives
// an INJECTED SchedulerTicker[]: one timer map, one schedule loop, one runner.
// Adding a tick is a new value in the SCHEDULER_TICKERS module factory and
// touches ZERO lines here. The core ticks (outbox/projection/reconciler) and
// the optional monitors are all assembled in scheduler.module.ts.
import { Inject, Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { SCHEDULER_TICKERS, type SchedulerTicker } from './scheduler-ticker.js';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly byKey: Map<string, SchedulerTicker>;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private stopped = false;

  constructor(
    @Inject(SCHEDULER_TICKERS) private readonly tickers: readonly SchedulerTicker[],
  ) {
    this.byKey = new Map(this.tickers.map((t) => [t.key, t]));
  }

  onModuleInit(): void {
    for (const ticker of this.tickers) this.scheduleNext(ticker);
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.stopped = true;
  }

  private scheduleNext(ticker: SchedulerTicker): void {
    if (this.stopped) return;
    const timer = setTimeout(() => { void this.runDrain(ticker); }, ticker.intervalMs);
    this.timers.set(ticker.key, timer);
  }

  // Run one ticker once inside a tagged Sentry isolation scope, capturing and
  // logging any failure. SINGLE source of the tag/try/catch/log logic -- both
  // the scheduled path (runDrain) and the test seam (drainByKey) delegate here,
  // so the error-handling branches exist exactly once.
  private async runTicker(ticker: SchedulerTicker): Promise<void> {
    // PDF Day-One #9: isolate background job breadcrumbs from HTTP request
    // scope. Sentry NestJS docs warn @Cron / BullMQ handlers leak into
    // unrelated request errors.
    await Sentry.withIsolationScope(async (scope) => {
      scope.setTag('job', ticker.tag);
      try {
        await ticker.run();
      } catch (err: unknown) {
        Sentry.captureException(err);
        if (err instanceof Error) {
          this.logger.error(ticker.label + err.message, err.stack);
        } else {
          this.logger.error(ticker.label + String(err));
        }
      }
    });
  }

  private async runDrain(ticker: SchedulerTicker): Promise<void> {
    try {
      await this.runTicker(ticker);
    } finally {
      // Re-arm regardless of outcome so a failing tick never stalls the loop.
      this.scheduleNext(ticker);
    }
  }

  // Test/diagnostic seam: run a single ticker once by key, with the same
  // isolation + error-capture as a scheduled tick but without arming a timer.
  // Replaces the old per-monitor drainOutbox/drainBreakglass/... methods; a new
  // ticker is reachable by key with no new method here. Unknown key is a no-op.
  async drainByKey(key: string): Promise<void> {
    const ticker = this.byKey.get(key);
    if (ticker === undefined) return;
    await this.runTicker(ticker);
  }
}
