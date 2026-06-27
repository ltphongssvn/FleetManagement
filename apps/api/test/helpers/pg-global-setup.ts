// apps/api/test/helpers/pg-global-setup.ts
// SINGLE-SHARED-CONTAINER globalSetup (2026 template-database pattern).
//
// This is the ONE module permitted to construct a Postgres testcontainer (the
// single-shared-container structural guard enforces that). It runs once, before
// any Vitest worker, off every per-file beforeAll critical path -- which is the
// durable cure for the recurring beforeAll container-startup timeouts: container
// startup cost is paid exactly ONCE for the whole run instead of racing inside N
// per-file hooks under parallel load.
//
// Mechanism:
//   1. Start ONE Postgres container (reused across the run).
//   2. Create a template database `fleet_test_template` and run all drizzle
//      migrations into it ONCE.
//   3. Close every connection to the template (Postgres forbids cloning a source
//      DB that has open sessions: "source database is being accessed by other
//      users"). The template is then never connected to again.
//   4. provide() the base connection (Zod-validated SSOT shape) so each test file
//      can `CREATE DATABASE <file> TEMPLATE fleet_test_template` -- a filesystem-
//      level clone in ~10ms, no per-file re-migration (Nirvana/pgtestdb 2026
//      pattern). Cloning inherits the template's encoding/collation, so no
//      LC_COLLATE/ENCODING overrides (which would raise 22023 incompatibility).
//
// The container itself is reaped by the existing global-teardown.ts (docker rm
// of testcontainers-labeled containers), which remains wired after this setup.
import type { TestProject } from 'vitest/node';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Wait } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../../src/database/schema/index.js';
import { TestPgConnectionSchema, TEST_PG_INJECT_KEY, type TestPgConnection } from './test-pg-connection-contract.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../src/database/migrations');
const POSTGRES_IMAGE = 'postgres:16.4-alpine3.20';
export const TEMPLATE_DB_NAME = 'fleet_test_template';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // 1) ONE container for the whole run. The doubled "ready to accept connections"
  // wait avoids the initdb-restart race where Postgres briefly serves on a local-
  // only socket before reloading the real pg_hba.conf (FATAL: no pg_hba.conf entry
  // for host "172.17.0.1").
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase('fleet_test_bootstrap')
    .withReuse()
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    // 2026 production-grade resource caps (oneuptime.com 2026-02, 2026-04):
    // explicit cgroup bounds eliminate the resource-contention OOM/exhaustion
    // that recurrently took the shared container down mid-run during long
    // coverage passes (~1206 tests, ~235 CREATE DATABASE clones over ~9 min)
    // when other dev containers were active on the host. Postgres now has
    // GUARANTEED resources and cannot be starved by neighbors.
    .withSharedMemorySize(512 * 1024 * 1024) // 512 MB /dev/shm. Docker default
                                              // is 64 MB; Postgres uses /dev/shm
                                              // for dynamic shared memory
                                              // (parallel queries, large index
                                              // builds, many concurrent
                                              // connections) and exhausts under
                                              // sustained test load.
    .withResourcesQuota({ memory: 2, cpu: 2 }) // 2 GB RAM hard cap + 2 CPUs
                                                // reserved. Fits 9.7 GiB host
                                                // alongside 7 dev containers
                                                // and the test process.
    .withTmpFs({ '/var/lib/postgresql/data': 'rw' }) // 2026 universal testcontainer
                                                     // pattern (zenn.dev May 2025,
                                                     // ivandotv/vitest-database-containers,
                                                     // codepunkt.de Dec 2025).
                                                     // Postgres data files live in
                                                     // RAM instead of the container
                                                     // overlay FS: ~10x faster I/O,
                                                     // naturally bounded by the
                                                     // 2 GB memory cap above, and
                                                     // durability does not matter
                                                     // for an ephemeral test DB.
    .start();

  const host = container.getHost();
  const port = container.getPort();
  const user = container.getUsername();
  const password = container.getPassword();
  const bootstrapDb = container.getDatabase();

  // 2) Build + migrate the TEMPLATE once. Connect to the bootstrap DB to issue the
  // CREATE DATABASE for the template, then connect to the template to migrate it.
  const adminUri =
    'postgres://' + user + ':' + password + '@' + host + ':' + String(port) + '/' + bootstrapDb;
  const adminPool = new Pool({ connectionString: adminUri, connectionTimeoutMillis: 10_000 });
  try {
    // CREATE DATABASE is not transactional and has no IF NOT EXISTS; under
    // .withReuse() a prior run may have left the template, so drop-if-exists first
    // (terminate any stragglers, then drop) to guarantee a clean migrated template.
    await adminPool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [TEMPLATE_DB_NAME],
    );
    await adminPool.query('DROP DATABASE IF EXISTS ' + quoteIdent(TEMPLATE_DB_NAME));
    await adminPool.query('CREATE DATABASE ' + quoteIdent(TEMPLATE_DB_NAME));
  } finally {
    await adminPool.end();
  }

  const templateUri =
    'postgres://' + user + ':' + password + '@' + host + ':' + String(port) + '/' + TEMPLATE_DB_NAME;
  const templatePool = new Pool({ connectionString: templateUri, connectionTimeoutMillis: 10_000 });
  try {
    const db = drizzle(templatePool, { schema, casing: 'snake_case' });
    await migrate(db, { migrationsFolder });
  } finally {
    // 3) CRUCIAL: close ALL connections to the template so it can be used as a
    // CREATE DATABASE ... TEMPLATE source (no open sessions allowed on the source).
    await templatePool.end();
  }

  // 4) provide the Zod-validated base connection (SSOT). Parsing here means a
  // malformed shape fails loudly in globalSetup, not as a confusing undefined
  // deep inside a test file's beforeAll.
  const connection: TestPgConnection = TestPgConnectionSchema.parse({
    host,
    port,
    user,
    password,
    database: bootstrapDb,
  });
  project.provide(TEST_PG_INJECT_KEY, connection);

  return async function teardown(): Promise<void> {
    // Container REMOVAL has a single owner: global-teardown.ts, which docker-rm -f
    // removes every testcontainers-labeled container at run end. We deliberately do
    // NOT stop the container here: stop() defaults to removing it, which would race
    // global-teardown docker rm and 404. With .withReuse() the container is meant to
    // outlive this setup and be reaped by the labeled cleanup pass.
  };
}

// Minimal identifier quoting for the fixed template name (defense-in-depth even
// though the name is a constant): double-quote and escape embedded quotes.
function quoteIdent(name: string): string {
  const dq = String.fromCharCode(34);
  return dq + name.split(dq).join(dq + dq) + dq;
}

// Type-safe provide/inject: declare the provided context key + shape so test
// files get compile-time typing on inject(TEST_PG_INJECT_KEY).
declare module 'vitest' {
  interface ProvidedContext {
    testPgConnection: TestPgConnection;
  }
}
