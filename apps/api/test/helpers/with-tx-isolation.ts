// apps/api/test/helpers/with-tx-isolation.ts
// 2026 test-isolation helper: wraps a test body in an outer drizzle
// transaction, constructs the SUT with `tx` as its db client so any inner
// `this.db.transaction(...)` becomes a SAVEPOINT under us, then forces
// rollback at the end. Empirical perf (Probe 4): ~43ms/test vs ~84ms/test
// with TRUNCATE on PGlite — roughly 2x faster, and removes the need to
// hardcode table names in TRUNCATE statements (refactor-safe).
//
// Architectural prerequisite for callers: the SUT must accept its db via
// constructor injection and must NOT keep a closed-over reference to the
// outer testDb.db. Probes 1 and 2 demonstrated that violating this
// produces a 60s deadlock or "Failed query: savepoint sp1" errors.
//
// Caveats:
//   - Concurrency tests that rely on multiple real connections cannot use
//     this helper (a transaction is single-connection). Keep TRUNCATE there.
//   - Inside `body`, ALL writes must go through `tx` (passed as the
//     argument) — direct testDb.db.insert(...) would commit independently
//     and bypass the rollback.
//
// The .catch(()=>{}) at the end swallows drizzle's expected "RollbackError"
// signal that tx.rollback() raises to abort the transaction callback.
import type { PgliteTestDb } from './pglite-test-db.js';
export type TestTx = PgliteTestDb['db'];
export async function withTxIsolation<T>(
  testDb: PgliteTestDb,
  body: (tx: TestTx) => Promise<T>,
): Promise<T | undefined> {
  let captured: T | undefined;
  await testDb.db
    .transaction(async (tx) => {
      captured = await body(tx as TestTx);
      tx.rollback();
    })
    .catch(() => { /* expected: drizzle RollbackError signal */ });
  return captured;
}
