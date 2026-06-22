// apps/api/test/helpers/test-pg-connection-contract.ts
// SSOT for the ONE piece of data that crosses the Vitest globalSetup -> test-file
// thread boundary (2026 single-shared-container pattern). globalSetup starts the
// Postgres testcontainer ONCE, before any worker, and `provide()`s its base
// connection info; each test file `inject()`s it and creates a per-file database
// on that shared server. Because provide/inject serializes across thread
// contexts, the payload must be plain serializable data — exactly what a Zod
// object validates. This schema is the contract: globalSetup must emit it,
// helpers parse it on inject and fail fast + clearly if the shape is wrong
// (e.g. globalSetup failed to start the container), instead of a confusing
// undefined-property error deep in a beforeAll.
import { z } from 'zod';

// Base connection to the SHARED Postgres testcontainer (the server, not a
// per-file database). host/port are the Docker-mapped host endpoint; user/
// password are the container superuser used to CREATE/DROP per-file databases;
// `database` is the container's bootstrap database (per-file DBs are created
// against it). All fields required + .strict(): a missing field means
// globalSetup is broken and tests must not silently proceed.
export const TestPgConnectionSchema = z
  .object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    user: z.string().min(1),
    password: z.string().min(1),
    database: z.string().min(1),
  })
  .strict();
export type TestPgConnection = z.infer<typeof TestPgConnectionSchema>;

// The provide/inject key. Single exported constant so globalSetup and every
// helper reference the SAME key (no string drift — the test-infra analogue of a
// shared schema identifier).
export const TEST_PG_INJECT_KEY = 'testPgConnection' as const;
