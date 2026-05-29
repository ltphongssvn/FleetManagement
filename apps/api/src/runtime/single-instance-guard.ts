// apps/api/src/runtime/single-instance-guard.ts
// Pilot invariant guard: enforces single-node Socket.IO assumption per
// PDF Day-One Pilot §6 ("In-process Socket.IO on API (single node — no
// Redis adapter yet)") and §"Explicitly deferred" (Redis Streams adapter
// trigger: >1 API instance needed). Fails fast at boot if the deployment
// is misconfigured to run multiple instances, preventing silent breakage
// of the in-process pending-command map and operator/depot rooms.
//
// Contract:
// - EXPECTED_INSTANCE_COUNT unset  -> no-op (local dev / tests)
// - EXPECTED_INSTANCE_COUNT = "1"  -> no-op (pilot)
// - EXPECTED_INSTANCE_COUNT > 1    -> throw (deferred work not yet built)
// - EXPECTED_INSTANCE_COUNT NaN    -> throw (fail-fast on misconfig)
//
// When the Redis Streams adapter ADR is opened (trigger fires), this
// guard is removed in the same PR that introduces the adapter.

export function assertSingleInstance(env: Readonly<Record<string, string | undefined>>): void {
  const raw = env['EXPECTED_INSTANCE_COUNT'];
  if (raw === undefined || raw === '') return;

  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `EXPECTED_INSTANCE_COUNT must be a positive integer, got ${JSON.stringify(raw)}`,
    );
  }

  if (n > 1) {
    const machine = env['FLY_MACHINE_ID'] ?? 'unknown';
    throw new Error(
      `single-instance invariant violated: EXPECTED_INSTANCE_COUNT=${String(n)} ` +
        `but pilot Socket.IO is in-process (PDF Day-One §6). ` +
        `FLY_MACHINE_ID=${machine}. ` +
        `Open ADR for Redis Streams adapter before scaling beyond 1 instance.`,
    );
  }
}
