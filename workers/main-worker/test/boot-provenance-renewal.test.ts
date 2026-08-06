// workers/main-worker/test/boot-provenance-renewal.test.ts
// RED (t86, 2026-08-06): the worker heartbeat must be RENEWED, not written once.
//
// THE DEFECT, measured in production. /health/worker-version answered
//   503 no worker provenance recorded: the worker has not booted, or its
//   heartbeat expired
// 39 minutes after a SUCCESSFUL worker deploy. The key is written exactly once,
// in main.ts bootstrap, with EX 900. So it expires 15 minutes after boot
// whether the worker is healthy or dead, and the endpoint is wrong in BOTH
// directions:
//   0-15 min after boot : key PRESENT even if the process died at minute 1
//   after 15 min        : key ABSENT even if the process is perfectly healthy
// It can only distinguish "booted recently" from "everything else", so its own
// header claim -- that an expired key proves the worker died -- does not hold.
//
// THE 2026 PATTERN. A liveness heartbeat is RENEWED on an interval and the TTL
// is sized at roughly THREE TIMES that interval: long enough that one missed
// renewal (a Redis hiccup, a GC pause) is not a false death, short enough that
// a real death is detected inside one window. Written-once-plus-TTL is a
// deploy-window marker, not a heartbeat.
//
// WHAT THIS DOES NOT CHANGE. Renewal stays fire-and-forget and unref'd:
// provenance is a REPORTING concern and must never keep the process alive or
// stop it consuming jobs. TTL stays 900s so the api contract is untouched.
import { describe, expect, it } from 'vitest';
import {
  WORKER_PROVENANCE_TTL_SECONDS,
  WORKER_PROVENANCE_REFRESH_SECONDS,
} from '@fleet/sync-protocol';
import { provenanceRefreshIntervalMs } from '../src/boot-provenance.js';
describe('worker provenance renewal cadence', () => {
  it('renews well before the TTL expires, so one missed renewal is not a death', () => {
    expect(WORKER_PROVENANCE_REFRESH_SECONDS).toBeLessThan(WORKER_PROVENANCE_TTL_SECONDS);
  });
  it('sizes the TTL at roughly 3x the renewal interval (the liveness rule)', () => {
    const ratio = WORKER_PROVENANCE_TTL_SECONDS / WORKER_PROVENANCE_REFRESH_SECONDS;
    expect(ratio).toBeGreaterThanOrEqual(2);
    expect(ratio).toBeLessThanOrEqual(4);
  });
  it('tolerates at least two consecutive missed renewals before reporting absent', () => {
    // A single Redis blip must not read as a dead worker. With TTL = 3x the
    // interval, two renewals can fail and the third still lands inside the
    // window.
    expect(WORKER_PROVENANCE_REFRESH_SECONDS * 2).toBeLessThan(WORKER_PROVENANCE_TTL_SECONDS);
  });
  it('exposes the interval in MILLISECONDS, the unit setInterval takes', () => {
    expect(provenanceRefreshIntervalMs()).toBe(WORKER_PROVENANCE_REFRESH_SECONDS * 1000);
  });
  it('does not renew so often that it becomes chatter against Redis', () => {
    // One SET per interval, forever. A short interval buys nothing: detection
    // is bounded by the TTL, not by the write rate.
    expect(WORKER_PROVENANCE_REFRESH_SECONDS).toBeGreaterThanOrEqual(60);
  });
});
