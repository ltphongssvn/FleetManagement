// apps/api/src/common/clock.ts
// Time abstraction for deterministic testing of time-dependent code paths.
// Production code injects Clock instead of calling new Date() / Date.now()
// directly, allowing tests to substitute a fake clock without global timer
// mocking (which is flaky and bleeds across vitest test boundaries).
//
// Scope: this audit introduces Clock for commands.gateway.ts only. Other
// services using new Date() (metrics, projections, outbox-relay, manifest,
// sync, device, erp-inbound, operator-context, s3-blob-store) will adopt
// it incrementally as they are audited.

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export const CLOCK = Symbol('Clock');
