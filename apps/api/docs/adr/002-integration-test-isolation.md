# ADR-002: Integration test isolation — tx-injection vs TRUNCATE

## Status
Partially adopted (Stage 1 complete, Stages 2 + 4 deferred).

## Context
The integration suite used per-test `TRUNCATE TABLE ... CASCADE` for state
isolation. Empirical perf on PGlite was ~84 ms/test; on Testcontainers
Postgres ~300 ms/test. Cumulative integration suite runtime was ~198 s.

Investigation (4 probes documented in commit history) established that:

1. **Outer-tx wrap + global SUT** (`new TransportOrdersService(testDb.db)`
   inside `testDb.db.transaction(...)`) **deadlocks for 60 s** on PGlite.
   The SUT's `this.db.transaction(...)` tries to open a second transaction
   on PGlite's single connection while the outer tx is still open.

2. **Pre-captured tx + use across `it()` blocks** fails with
   `Failed query: savepoint sp1`. drizzle's `transaction()` callback COMMITs
   on return, so the captured `tx` is dead by the time the test body runs.

3. **In-scope tx-injection** (constructing SUT with `tx` *inside* the same
   `db.transaction()` callback that runs the test body, then calling
   `tx.rollback()`) **works correctly on both PGlite and Testcontainers**.
   The SUT's inner `this.db.transaction(...)` becomes a SAVEPOINT under our
   outer tx; the outer rollback cleans everything up.

   Empirical perf: ~43 ms/test on PGlite (≈2× faster than TRUNCATE).

4. **`toThrow(Class)` vs `toBeInstanceOf(Class)`** are functionally
   equivalent for typed-error assertions — Vitest's `toThrow` accepts an
   Error constructor and matches by `instanceof`.

## Decision

Adopt the in-scope tx-injection pattern via `test/helpers/with-tx-isolation.ts`
for service tests that:
  - construct a single SUT per test,
  - do not depend on multi-connection concurrency,
  - do not bootstrap a NestJS application context.

## Migration tiers

| Tier | Description | Status |
|---|---|---|
| 1 | Mechanical service tests (PGlite, no concurrency, no Nest app) | **Migrated** (11 files, 56 tests) |
| 2 | Service tests on Testcontainers with heavy multi-line SQL literals | **Deferred** — 1 file (`projection-runner.service.integration.test.ts`) |
| 3 | Concurrency tests that need multiple connections | **Stays on TRUNCATE** — `outbox-relay.service.integration.test.ts`, `commands.controller.concurrency.integration.test.ts` |
| 4 | NestJS controller tests with DI-wired DRIZZLE_DB | **Deferred** — 3 files (`commands.controller`, `commands.controller.tenant-policy`, `dispatch.controller`) |

## Consequences

**Positive:**
- Stage 1 reduces full integration suite runtime by ~30 s (198 s → 168 s).
- Per-test isolation no longer hardcodes table names in TRUNCATE statements
  — schema rename does not break tests.
- Inner `this.db.transaction(...)` calls are still exercised end-to-end as
  SAVEPOINTs, so transactional correctness invariants remain tested.

**Negative:**
- Two patterns coexist in the suite (tx-injection for Tier 1, TRUNCATE for
  Tiers 2/3/4) until Stages 2 + 4 complete.
- Concurrency tests in Tier 3 are correct as-is and never migrate.

## Required prerequisites for an SUT to use tx-injection

1. Accept its db client via constructor (most do already).
2. Must NOT hold a reference to a global db captured at module load time.
3. Inner `this.db.transaction(...)` calls are fine — they become SAVEPOINTs.

## Helper API

```ts
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';

await withTxIsolation(testDb, async (tx) => {
  const svc = new MyService(tx as never);
  // ... seed via tx.insert(...), call svc methods, assert
});
```

The helper rolls back the outer transaction at the end and swallows
drizzle's expected `RollbackError` signal.
