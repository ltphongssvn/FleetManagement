// workers/main-worker/src/boot-provenance.ts
// The worker's answer to "which COMMIT is live?".
//
// THE GAP THIS CLOSES. railway-deploy stamps GIT_SHA on the worker
// (deploy-stamp --stamp --service worker), but the deploy step is
// `sleep 30; railway logs ... || true` -- a gate that CANNOT fail. The worker
// could crash-loop, or run a release behind, and the deploy would still be
// green. api and ops-web each answer a version endpoint; the worker had no way
// to be asked.
//
// WHY REDIS AND NOT AN HTTP ENDPOINT. The worker has no HTTP surface and no
// public Railway domain, so CI cannot probe it directly. The 2026 pattern for a
// background service is a heartbeat written to a store the verifier can read.
// Writing it proves the process BOOTED AND REACHED ITS DEPENDENCIES -- strictly
// stronger than grepping a log line, which proves only that a string was
// printed, and which depends on log retention and on the very Railway log
// stream that `railway up` already fails to deliver reliably (the transient
// "Failed to stream build logs" that reddens deploys).
//
// WHY A TTL. Provenance that outlived the process would let CI verify a worker
// that has since died. The key expires, so a stale heartbeat reads as ABSENT
// and the check fails closed rather than confirming a ghost.
//
// The payload is the SAME contract api and ops-web answer: one schema, four
// consumers. Pure planners here; only main.ts performs the write.
import {
  buildDeployVersion,
  WORKER_PROVENANCE_KEY,
  WORKER_PROVENANCE_TTL_SECONDS,
  WORKER_PROVENANCE_REFRESH_SECONDS,
  type DeployVersion,
  type ProvenanceEnv,
} from '@fleet/sync-protocol';

// The key and TTL live in the shared contract, not here: the api reads this
// same key on /health/worker-version, so a local copy would be a second
// definition of a value two services must agree on exactly.
export { WORKER_PROVENANCE_KEY, WORKER_PROVENANCE_TTL_SECONDS, WORKER_PROVENANCE_REFRESH_SECONDS };

/** The worker's provenance, from the same builder api and ops-web use. */
export function buildBootProvenance(env: ProvenanceEnv, now: () => string): DeployVersion {
  return buildDeployVersion(env, now);
}

/** Redis SET argv for the heartbeat. EX (never PERSIST/KEEPTTL): an entry that
 *  outlives the process is exactly the stale-provenance failure this guards.
 *
 *  The return type is a TUPLE with a LITERAL 'EX', not string[]. ioredis types
 *  `set` as a large overload set keyed on literal flag values, so a plain
 *  string[] spread matches no overload and TypeScript reports the LAST one
 *  ("KEEPTTL"), which is misleading. Carrying the literal here means the call
 *  site needs no cast -- and a cast would have silenced exactly the check that
 *  proves the expiry flag is the one we intend. */
export type BootProvenanceSetArgs = readonly [key: string, value: string, mode: 'EX', ttl: string];

export function bootProvenanceSetArgs(version: DeployVersion): BootProvenanceSetArgs {
  return [
    WORKER_PROVENANCE_KEY,
    JSON.stringify(version),
    'EX',
    String(WORKER_PROVENANCE_TTL_SECONDS),
  ] as const;
}

/** The renewal cadence in MILLISECONDS -- the unit setInterval takes.
 *
 *  WHY A FUNCTION AND NOT A CONSTANT. The seconds value is the contract both
 *  services agree on; the millisecond form is a local presentation of it. A
 *  second exported constant could drift from its own source, so the conversion
 *  lives in one place and is derived, never restated.
 *
 *  WHY RENEWAL AT ALL. The heartbeat used to be written ONCE at boot with a
 *  900s TTL, which made it a deploy-window marker rather than a liveness
 *  signal: it expired 15 minutes after boot whether the worker was healthy or
 *  dead. Production proved it on 2026-08-06 -- /health/worker-version answered
 *  503 thirty-nine minutes after a successful worker deploy, with the worker's
 *  actual state unknown either way. Renewing on an interval makes ABSENT mean
 *  what the reader has always claimed it means. */
export function provenanceRefreshIntervalMs(): number {
  return WORKER_PROVENANCE_REFRESH_SECONDS * 1000;
}

/** Handle for a running renewal loop. `stop` exists so a test can end it and a
 *  shutdown path could, if it ever needed to, without reaching for the timer. */
export interface ProvenanceRenewal {
  stop: () => void;
}

/** Start the heartbeat: write once immediately, then re-write every intervalMs.
 *
 *  THE WRITE IS INJECTED, and that is the point. The previous tests pinned only
 *  the CONSTANTS -- refresh < ttl, the ms conversion -- and every one of them
 *  still passed if the setInterval were deleted outright. They asserted intent,
 *  not behaviour, which is the same error that shipped a --reporter=dot "fix"
 *  whose flag never reached the tool. With the write as a parameter, a fake
 *  timer can advance time and observe that the call ACTUALLY REPEATS.
 *
 *  ERRORS ARE SWALLOWED PER TICK, never allowed to escape. A throw inside a
 *  setInterval callback surfaces as an uncaught exception; depending on the
 *  process handlers that either kills the worker or silently ends the loop, and
 *  a heartbeat that stops after one Redis blip reads as a DEAD WORKER forever
 *  after. One failed renewal must cost one missed beat and nothing more -- the
 *  TTL is sized at 3x the interval precisely so that is survivable.
 *
 *  unref(): provenance is a REPORTING concern and must never be the reason this
 *  process stays alive. The worker's SIGTERM path closes queues and exits; a
 *  referenced timer would keep the event loop alive and turn a clean shutdown
 *  into a timeout kill. */
export function startProvenanceRenewal(
  write: (first: boolean) => void,
  intervalMs: number,
): ProvenanceRenewal {
  const safeWrite = (first: boolean): void => {
    try {
      write(first);
    } catch {
      // Deliberately silent here: the injected write owns its own logging, and
      // a reporting failure must not become a second failure channel.
    }
  };
  safeWrite(true);
  const timer = setInterval(() => {
    safeWrite(false);
  }, intervalMs);
  timer.unref();
  return {
    stop: (): void => {
      clearInterval(timer);
    },
  };
}
