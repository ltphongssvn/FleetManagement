// apps/api/test/helpers/migrate-test-db.ts
// Per-file test database on the SHARED Postgres container (2026 single-shared-
// container + template-database pattern). This helper no longer starts a
// container (the single-shared-container structural guard forbids it); the one
// container is started once in pg-global-setup.ts. Here we:
//   1. inject() the shared base connection (Zod-validated SSOT shape),
//   2. CREATE DATABASE <name> TEMPLATE fleet_test_template -- a filesystem-level
//      clone of the already-migrated template (~10ms, no per-file migration),
//   3. return a pool/db bound to that per-file database.
// Per-file databases are fully isolated, so files parallelize with zero shared-
// table contention -- which removes the beforeAll startup races that the old
// per-file-container model suffered under load.
//
// The exported surface (startMigratedTestDb / stopMigratedTestDb /
// truncateAllTables / MigratedTestDb) is UNCHANGED so existing integration specs
// need no edits.
import { inject } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import * as schema from '../../src/database/schema/index.js';
import { sql } from 'drizzle-orm';
import { TestPgConnectionSchema, TEST_PG_INJECT_KEY } from './test-pg-connection-contract.js';
import { TEMPLATE_DB_NAME } from './pg-global-setup.js';

// MigratedTestDb keeps `container` out of the shape now -- there is no per-file
// container. Existing files only ever touch `.db` and `.pool`, so this is
// compatible. The per-file database name is retained so teardown can DROP it.
export interface MigratedTestDb {
  readonly databaseName: string;
  readonly pool: Pool;
  readonly db: NodePgDatabase<typeof schema>;
}

// Double-quote a Postgres identifier (defense-in-depth; names are test-controlled).
function quoteIdent(name: string): string {
  const dq = String.fromCharCode(34);
  return dq + name.split(dq).join(dq + dq) + dq;
}

// Serialize CREATE DATABASE ... TEMPLATE across concurrently-starting files.
// Postgres refuses to clone a template that has ANY open session, and two
// simultaneous clones of the same template can collide; a transaction-scoped
// advisory lock makes the clone critical-section mutually exclusive. The lock
// auto-releases at COMMIT/ROLLBACK. Key is an arbitrary fixed bigint shared by
// all files (distinct from the migrate-era key, though migration no longer runs
// here).
const CLONE_ADVISORY_LOCK_KEY = 8123640095512774n;

function baseConnectionUri(database: string): string {
  const c = TestPgConnectionSchema.parse(inject(TEST_PG_INJECT_KEY));
  return (
    'postgres://' + c.user + ':' + c.password + '@' + c.host + ':' + String(c.port) + '/' + database
  );
}

const isTransientConnError = (e: unknown): boolean => {
  const msg = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: string } | undefined)?.code;
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === '57P01' ||
    /Connection terminated unexpectedly/i.test(msg) ||
    /timeout exceeded when trying to connect/i.test(msg) ||
    /ECONNRESET|ETIMEDOUT|read ECONNRESET/i.test(msg)
  );
};

export async function startMigratedTestDb(databaseName = 'fleet_test'): Promise<MigratedTestDb> {
  // Clone the migrated template into a per-file database. The effective DB name
  // ALWAYS gets a unique random suffix appended to the caller-supplied prefix, so
  // two files that pass the SAME name (e.g. the bare default) still get distinct,
  // fully isolated databases. This makes per-file isolation hold STRUCTURALLY
  // regardless of caller naming discipline: no file can DROP/terminate a database
  // another file is using (the 57P01 / 3D000 collisions seen when these specs run
  // in parallel). The readable prefix is kept so the DB name still identifies its
  // origin file when inspecting pg_stat_activity.
  const dbName = databaseName + '_' + randomBytes(6).toString('hex');
  // CREATE DATABASE is autocommit-only (it cannot run inside a transaction block)
  // and Postgres refuses to clone a template that has any open session, so we
  // serialize the clone across concurrently-starting files with a SESSION-level
  // advisory lock held on the SAME connection that runs the DDL. The lock + CREATE
  // DATABASE on one connection is what actually makes the clone critical-section
  // mutually exclusive (a lock on a different connection would not). A bounded
  // retry wraps the whole thing to absorb transient connection drops under load.
  const injected = TestPgConnectionSchema.parse(inject(TEST_PG_INJECT_KEY));
  const adminUri = baseConnectionUri(injected.database);

  const maxAttempts = 5;
  for (let attempt = 1; ; attempt++) {
    const adminPool = new Pool({ connectionString: adminUri, connectionTimeoutMillis: 10_000 });
    const client = await adminPool.connect();
    let locked = false;
    try {
      // Session advisory lock (blocks until acquired); released explicitly below.
      await client.query('SELECT pg_advisory_lock($1)', [CLONE_ADVISORY_LOCK_KEY.toString()]);
      locked = true;
      // The unique name should never pre-exist, but terminate + DROP IF EXISTS is
      // cheap insurance against an aborted prior run that left the same name. No
      // ENCODING/LC_* overrides: inherit from the template to avoid 22023.
      await client.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [dbName],
      );
      await client.query('DROP DATABASE IF EXISTS ' + quoteIdent(dbName));
      await client.query(
        'CREATE DATABASE ' + quoteIdent(dbName) + ' TEMPLATE ' + quoteIdent(TEMPLATE_DB_NAME),
      );
      break;
    } catch (err) {
      if (attempt >= maxAttempts || !isTransientConnError(err)) {
        if (locked) {
          try {
            await client.query('SELECT pg_advisory_unlock($1)', [CLONE_ADVISORY_LOCK_KEY.toString()]);
          } catch {
            /* connection broken; lock dies with the session anyway */
          }
        }
        client.release();
        await adminPool.end();
        throw err;
      }
      await new Promise((r) => setTimeout(r, 250 * attempt));
    } finally {
      if (locked) {
        try {
          await client.query('SELECT pg_advisory_unlock($1)', [CLONE_ADVISORY_LOCK_KEY.toString()]);
        } catch {
          /* connection broken; session-level lock auto-releases on disconnect */
        }
      }
      client.release();
      await adminPool.end();
    }
  }

  // Connect the returned pool to the freshly-cloned per-file database.
  const pool = new Pool({
    connectionString: baseConnectionUri(dbName),
    connectionTimeoutMillis: 10_000,
  });
  // Background-error sink (node-postgres docs: a Pool emits 'error' on behalf of
  // its idle clients when the backend drops a connection; with NO listener, Node
  // escalates it to an uncaught exception and the process exits non-zero). During
  // teardown stopMigratedTestDb() runs pg_terminate_backend on this database,
  // which makes any still-connected idle client emit a FATAL 57P01 ("terminating
  // connection due to administrator command"). If a test (e.g. the concurrency
  // spec that fires 20 simultaneous commands) leaves a connection draining when
  // pool.end() resolves, that straggler is terminated and its async 'error'
  // surfaces AFTER all test files passed -> the whole shard fails with an
  // unhandled 57P01 and zero failing assertions. This was an intermittent,
  // contention-sensitive CI flake. Swallowing ONLY background idle-client errors
  // here is safe: a real query error still rejects its own await inside the test;
  // pg routes only out-of-band connection errors through this emitter.
  pool.on('error', () => { /* idle-client connection error during teardown; ignore */ });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { databaseName: dbName, pool, db };
}

export async function stopMigratedTestDb(testDb: MigratedTestDb): Promise<void> {
  // Null-safe: a timed-out beforeAll never assigns testDb, so afterAll may call
  // this with undefined. Guard so one slow start surfaces ONE clear error, not a
  // cascading TypeError across unrelated files.
  const maybe = testDb as { pool?: Pool; databaseName?: string } | undefined;
  if (maybe?.pool === undefined) return;
  // Close this file pool first so connections from this run are not in the
  // terminate set below.
  await testDb.pool.end();

  // 2026 cleanup: DROP the per-file database to keep the shared container data
  // directory bounded across a long coverage run (~235 files clone the template
  // in one pass). The historical reason for NOT dropping -- racing with other
  // files CREATE DATABASE under the shared advisory lock -- only applied when
  // files ran in parallel. With vitest maxWorkers:1 + pool:forks (see
  // vitest.coverage.config.ts) files are STRICTLY sequential, so the race is
  // structurally impossible. Terminating stragglers first defends against the
  // (rare) afterAll path that crashed before pool.end() ran. Best-effort: a
  // DROP failure is logged but does not fail the suite (the container is reaped
  // at run end regardless, so leftover DBs are still bounded by the run length).
  const dbName = maybe.databaseName;
  if (typeof dbName !== 'string' || dbName.length === 0) return;
  const c = TestPgConnectionSchema.parse(inject(TEST_PG_INJECT_KEY));
  const adminPool = new Pool({
    connectionString: baseConnectionUri(c.database),
    connectionTimeoutMillis: 10_000,
  });
  try {
    await adminPool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [dbName],
    );
    await adminPool.query('DROP DATABASE IF EXISTS ' + quoteIdent(dbName));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write('[stopMigratedTestDb] DROP DATABASE ' + dbName + ' failed (non-fatal): ' + msg + '\n');
  } finally {
    await adminPool.end();
  }
}

// Truncate every public-schema table in a SINGLE atomic TRUNCATE (one statement
// takes AccessExclusiveLock on all relations, so concurrent files can't deadlock
// on lock ordering). __drizzle_migrations lives in the `drizzle` schema, not
// `public`, so migration bookkeeping survives. RESTART IDENTITY resets sequences.
export async function truncateAllTables(db: NodePgDatabase<typeof schema>): Promise<void> {
  const result = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const drizzleTable = '__drizzle_migrations';
  const tables = result.rows.map((r) => r.tablename).filter((t) => t !== drizzleTable);
  if (tables.length === 0) return;
  const dq = String.fromCharCode(34);
  const list = tables.map((t) => dq + t + dq).join(', ');
  await db.execute(sql.raw('TRUNCATE TABLE ' + list + ' RESTART IDENTITY CASCADE'));
}
