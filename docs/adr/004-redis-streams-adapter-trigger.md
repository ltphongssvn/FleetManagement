<!--
File:    FleetManagement/docs/adr/004-redis-streams-adapter-trigger.md
Purpose: Document the trigger boundary for the deferred Redis Streams
         Socket.IO adapter + session rooms + multi-node API scaling.
Why:     PDF "Frozen Manifest" mandates "Redis Streams adapter day-one"
         and "session rooms" as Correctness-always-on, but PDF Day-One
         Pilot §6 + §"Explicitly deferred" gate this on
         "trigger: >1 API instance needed". ADR 001 set precedent
         that trigger-gated deferred items belong in versioned ADRs.
         Without this ADR, the boundary is undocumented and the pilot
         risks silently scaling past the in-process invariant.
-->
# ADR-004: Redis Streams Adapter + Session Rooms — Trigger Boundary

- **Status**: Accepted
- **Date**: 2026-05-02
- **Deciders**: Architecture team
- **Related**: ADR-001, `apps/api/src/commands/commands.gateway.ts`,
  `apps/api/src/runtime/single-instance-guard.ts`, `apps/api/fly.toml`,
  `Fleet-Management-Stack.pdf` §"Realtime", §"Day-One Pilot §6",
  §"Explicitly deferred"

## Context

The Frozen Manifest (PDF §"Realtime") mandates as Correctness-always-on:
- "In-process Socket.IO + sticky sessions + Redis Streams adapter day-one"
- "Session rooms session:<device_session_id> + operator/depot/dispatch"
- "Mutability filter at subscription join; revocation check at every room join"
- "On adapter unhealthy: API refuses new connections (503) and drains"

The Day-One Pilot Plan (PDF §6) explicitly relaxes this for the 5-truck
pilot: "In-process Socket.IO on API (single node — no Redis adapter yet)
- Simple rooms: operator:<id>, depot:<id>".

The §"Explicitly deferred" section gates the full design on:
> "Session rooms + multi-node Socket.IO + Redis Streams adapter
>  (trigger: >1 API instance needed)"

`apps/api/src/commands/commands.gateway.ts` currently holds two
in-process data structures that are correct only under the single-node
invariant: the `pending` Map (tracks issued commands awaiting ack)
and the `latencies` array (rolling window for SLO measurement).
A second API instance would (a) miss `pending` entries when receiving
acks for commands issued elsewhere, and (b) fragment latency telemetry.
Likewise, `pushCommand` broadcasts via the local Socket.IO adapter only;
sockets connected to a peer instance would never receive the emit.

Without an explicit trigger ADR and a runtime guard, a routine
`fly scale count 2` (or auto-scale misconfig) would silently break
command delivery in production.

## Decision

1. **Defer Redis Streams adapter, session rooms, and multi-node Socket.IO**
   until the documented trigger fires.
2. **Trigger condition**: any of the following becomes true:
   - Pilot exit criteria met (PDF §"Exit criteria") AND a scale-up to
     >1 API instance is planned.
   - Sustained API CPU >70% on the single instance for 7 consecutive days.
   - Connection count approaches Fly shared-cpu-1x practical ceiling
     (≈4k concurrent Socket.IO clients).
3. **Pilot guard**: enforce the single-instance invariant at boot via
   `assertSingleInstance(process.env)` in `apps/api/src/main.ts`,
   driven by the `EXPECTED_INSTANCE_COUNT` env var (set to `"1"` in
   pilot deployments). The guard fails fast if misconfigured to a
   value >1, with `FLY_MACHINE_ID` logged for traceability.
4. **Removal contract**: when the trigger fires and the Redis Streams
   adapter is introduced, `assertSingleInstance` and its call site are
   removed in the same PR. This ADR is then superseded by the
   adapter-introduction ADR.

## Rationale

- **PDF compliance**: §"Session boundary note" point 3 forbids
  implementing deferred items even when tempting. Adding the adapter
  now violates the frozen pilot scope.
- **Cost**: the Redis Streams adapter, session rooms, mutability filter,
  and adapter-health 503 drain logic together represent ~2 weeks of
  engineering not budgeted in the 10-week pilot plan.
- **Safety**: without the guard, the in-process `pending` map and
  operator-room broadcast would silently break on scale-out. The guard
  converts a silent correctness failure into a loud boot failure.
- **Discoverability**: ADR 001 established that trigger-gated work
  belongs in ADRs. This ADR closes the gap for the highest-impact
  deferred item.

## Alternatives Considered

- **Option A: Implement Redis Streams adapter now.**
  Rejected — violates PDF §"Session boundary note" #3 and consumes
  pilot budget.
- **Option B: Cap instance count declaratively in `fly.toml`.**
  Rejected — Fly schema (verified via
  https://fly.io/docs/reference/configuration/) supports
  `min_machines_running` but no `max_machines_running` key. Caps are
  enforced via `fly scale count N` CLI, which is operationally
  bypassable. A runtime guard catches the misconfiguration regardless
  of how it was applied.
- **Option C: Document the boundary in the PDF only, no code guard.**
  Rejected — relies on operator memory; pilot has no on-call rotation
  yet to catch silent breakage.

## Consequences

**Positive**:
- Boot-time fail-fast prevents silent multi-instance breakage.
- ADR establishes a removal contract so the guard cannot outlive its
  purpose.
- Documented trigger condition gives operators a clear escalation path.

**Negative**:
- One additional env var (`EXPECTED_INSTANCE_COUNT`) to set per deploy.
- Engineers unfamiliar with the deferral model may try to scale and
  hit the guard; mitigated by the error message pointing to this ADR.

**Neutral**:
- Guard is a no-op when the env var is unset (local dev, tests).

## Future Work

When the trigger fires, in one PR:
1. Add `@socket.io/redis-streams-adapter` and wire it in
   `apps/api/src/commands/commands.gateway.ts`.
2. Migrate `pending` Map → Redis hash keyed by commandId with TTL.
3. Migrate `latencies` array → OTel histogram (export-only;
   no in-process aggregation).
4. Add session rooms `session:<device_session_id>` per PDF §"Realtime".
5. Add mutability filter + revocation check at room join.
6. Add adapter-health endpoint; on unhealthy → API returns 503 and
   drains (PDF §"Realtime").
7. Remove `apps/api/src/runtime/single-instance-guard.ts` and its
   call site in `apps/api/src/main.ts`.
8. Remove `EXPECTED_INSTANCE_COUNT` from deployment configs.
9. Open ADR-005 superseding this one.

## Verification

Empirical confirmation that the guard works:

```
cd apps/api && pnpm vitest run test/single-instance-guard.test.ts
# Expect: 5/5 passed
```

Empirical confirmation that the deferral is honored:

```
grep -rn "redis-streams-adapter\|@socket.io/redis" apps/api/src
# Expect: no matches until trigger fires
```

Empirical confirmation that PDF mandate is acknowledged:

```
grep -n "Redis Streams adapter\|session rooms" docs/adr/004-redis-streams-adapter-trigger.md
# Expect: matches in Context and Decision sections
```
