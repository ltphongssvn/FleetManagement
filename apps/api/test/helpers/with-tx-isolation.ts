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
// produces a 60s deadlock or 'Failed query: savepoint sp1' errors.
//
// Caveats:
//   - Concurrency tests that rely on multiple real connections cannot use
//     this helper (a transaction is single-connection). Keep TRUNCATE there.
//   - Inside `body`, ALL writes must go through `tx` (passed as the
//     argument) — direct testDb.db.insert(...) would commit independently
//     and bypass the rollback.
//
// Error propagation (T5b fix): the helper distinguishes drizzle's expected
// rollback signal (a DrizzleError with message === 'Rollback') from any
// other error thrown inside body. Only the rollback signal is swallowed;
// all other errors — assertion failures, unique violations, domain
// rejections — propagate to the caller so failing tests fail loudly.
import type { PgliteTestDb } from './pglite-test-db.js';
export type TestTx = PgliteTestDb['db'];
function isDrizzleRollbackSignal(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const msg = (err as { message?: unknown }).message;
  return typeof msg === 'string' && msg === 'Rollback';
}
export async function withTxIsolation<T>(
  testDb: PgliteTestDb,
  body: (tx: TestTx) => T | Promise<T>,
): Promise<T | undefined> {
  let captured: T | undefined;
  let bodyError: unknown = null;
  try {
    await testDb.db.transaction(async (tx) => {
      try {
        captured = await body(tx as TestTx);
      } catch (e) {
        bodyError = e;
      } finally {
        // Always force rollback. Drizzle raises its 'Rollback' signal up
        // to the .transaction() promise, which we swallow below.
        tx.rollback();
      }
    });
  } catch (e) {
    if (!isDrizzleRollbackSignal(e)) {
      // Unexpected: outer transaction rejected with something other than
      // drizzle's rollback signal. Surface it.
      throw e;
    }
  }
  if (bodyError !== null) {
    if (bodyError instanceof Error) throw bodyError;
    throw new Error(typeof bodyError === 'string' ? bodyError : 'unknown body error: ' + JSON.stringify(bodyError));
  }
  return captured;
}
