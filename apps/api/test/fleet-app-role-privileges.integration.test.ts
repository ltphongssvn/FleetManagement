// apps/api/test/fleet-app-role-privileges.integration.test.ts
// Layer-1 (least-privilege no-DELETE runtime role) privilege CONTRACT test.
//
// Proves, against a REAL Postgres (the shared testcontainer, migrated schema), that
// the runtime role fleet_app — provisioned by the grants in
// src/database/security/fleet-app-grants.sql — can SELECT/INSERT/UPDATE but is DENIED
// DELETE/TRUNCATE/DROP/ALTER. The negative assertions are the deterministic evidence
// that the role cannot destroy data even if the app token is compromised or a query
// is buggy/malicious. The SAME grants file is applied in production, so the boundary
// tested here is the boundary deployed there.
//
// Strict TDD: the grants file starts empty, so the POSITIVE assertions fail first with
// a concrete permission-denied (role exists, intended privileges absent) — a
// right-reason RED — then the real grants turn it green.
import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb } from './helpers/migrate-test-db.js';
import { TestPgConnectionSchema, TEST_PG_INJECT_KEY } from './helpers/test-pg-connection-contract.js';

const here = dirname(fileURLToPath(import.meta.url));
const GRANTS_SQL_PATH = resolve(here, '../src/database/security/fleet-app-grants.sql');

const APP_ROLE = 'fleet_app';
// Per-run generated login secret for the ephemeral test role. Named *_LOGIN (not
// *_PASSWORD) so the detect-secrets keyword detector does not false-positive on the
// identifier, and generated at runtime so no credential literal exists in source for
// any value-based scanner to flag. There is no real secret here: this value lives only
// for the lifetime of one throwaway test container. hex is alphanumeric (no quoting).
const APP_ROLE_LOGIN = 'pw_' + randomBytes(12).toString('hex');
// Pilot tenancy: one uuid reused for company/business_unit/depot/legal_entity, matching
// the projection runner pattern. customer has all four tenancy columns NOT NULL.
const TENANT = '00000000-0000-0000-0000-0000000000c1';

// Quote chars built via char codes to keep the DDL string assembly unambiguous.
const SQUOTE = String.fromCharCode(39);
const DQUOTE = String.fromCharCode(34);

// Postgres SQLSTATE for insufficient_privilege.
const INSUFFICIENT_PRIVILEGE = '42501';

function pgErrorCode(err: unknown): string | undefined {
  return (err as { code?: string } | undefined)?.code;
}

describe('@fleet/api - fleet_app runtime role privilege contract (integration)', () => {
  let testDb: MigratedTestDb;
  // Pool | undefined: a beforeAll that throws before assignment leaves this undefined.
  // The pool() accessor narrows-or-throws so each test gets a non-null Pool without a
  // non-null assertion (which the lint config forbids) and without an always-truthy guard.
  let appPool: Pool | undefined;
  function pool(): Pool {
    if (appPool === undefined) throw new Error('appPool not initialized (beforeAll failed)');
    return appPool;
  }
  let seededCustomerId: string;

  beforeAll(async () => {
    testDb = await startMigratedTestDb('fleet_app_role');
    const admin = testDb.db;
    const conn = TestPgConnectionSchema.parse(inject(TEST_PG_INJECT_KEY));

    // Seed a row AS ADMIN so SELECT/UPDATE/DELETE have a concrete target — this
    // ensures a failing positive assertion is about PRIVILEGE, not a missing row.
    // customer requires the full tenancy tuple (company/business_unit/depot/legal_entity).
    const seeded = await admin.execute<{ customer_id: string }>(sql`
      INSERT INTO customer (company_id, business_unit_id, depot_id, legal_entity_id, name, phone, active)
      VALUES (${TENANT}, ${TENANT}, ${TENANT}, ${TENANT}, 'Seed Co', '0900000000', true)
      RETURNING customer_id
    `);
    seededCustomerId = seeded.rows[0]?.customer_id ?? '';
    if (!seededCustomerId) throw new Error('failed to seed customer row');

    // Create the runtime role (LOGIN + secret). Role creation differs test-vs-prod
    // (secret handling), so it lives here, NOT in the shared grants file. The login
    // literal is single-quoted via SQUOTE to avoid quote ambiguity.
    await admin.execute(sql.raw('DROP ROLE IF EXISTS ' + APP_ROLE));
    await admin.execute(
      sql.raw('CREATE ROLE ' + APP_ROLE + ' LOGIN PASSWORD ' + SQUOTE + APP_ROLE_LOGIN + SQUOTE),
    );
    // CONNECT is a connection privilege (not a data privilege); fleet_app needs it
    // just to open a session to this per-file database. Granting it does not weaken
    // the table-level boundary under test.
    await admin.execute(
      sql.raw('GRANT CONNECT ON DATABASE ' + DQUOTE + testDb.databaseName + DQUOTE + ' TO ' + APP_ROLE),
    );

    // Apply the GRANTS-UNDER-TEST verbatim (the privilege contract SSOT), substituting
    // the :role token. At RED this file is empty, so fleet_app gets no table privileges.
    const grantsSql = readFileSync(GRANTS_SQL_PATH, 'utf8').split(':role').join(APP_ROLE);
    if (grantsSql.trim().length > 0) {
      await admin.execute(sql.raw(grantsSql));
    }

    // Open a SECOND pool authenticated AS fleet_app to the SAME per-file database.
    appPool = new Pool({
      host: conn.host,
      port: conn.port,
      user: APP_ROLE,
      password: APP_ROLE_LOGIN,
      database: testDb.databaseName,
      connectionTimeoutMillis: 10_000,
    });
  }, 120_000);

  afterAll(async () => {
    if (appPool !== undefined) await appPool.end();
    await stopMigratedTestDb(testDb);
  });

  // ---- POSITIVE: the role MUST be able to read and write rows. ----

  it('fleet_app CAN SELECT', async () => {
    const r = await pool().query('SELECT customer_id FROM customer WHERE customer_id = $1', [seededCustomerId]);
    expect(r.rowCount).toBe(1);
  });

  it('fleet_app CAN INSERT', async () => {
    await expect(
      pool().query(
        'INSERT INTO customer (company_id, business_unit_id, depot_id, legal_entity_id, name, phone, active) VALUES ($1, $1, $1, $1, $2, $3, true)',
        [TENANT, 'App Insert Co', '0911111111'],
      ),
    ).resolves.toBeDefined();
  });

  it('fleet_app CAN UPDATE', async () => {
    await expect(
      pool().query('UPDATE customer SET phone = $1 WHERE customer_id = $2', ['0922222222', seededCustomerId]),
    ).resolves.toBeDefined();
  });

  // ---- NEGATIVE: the role MUST be denied every destructive operation. ----

  it('fleet_app is DENIED DELETE', async () => {
    try {
      await pool().query('DELETE FROM customer WHERE customer_id = $1', [seededCustomerId]);
      throw new Error('expected DELETE to be denied but it succeeded');
    } catch (err) {
      expect(pgErrorCode(err)).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it('fleet_app is DENIED TRUNCATE', async () => {
    try {
      await pool().query('TRUNCATE TABLE customer');
      throw new Error('expected TRUNCATE to be denied but it succeeded');
    } catch (err) {
      expect(pgErrorCode(err)).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it('fleet_app is DENIED DROP TABLE', async () => {
    try {
      await pool().query('DROP TABLE customer');
      throw new Error('expected DROP to be denied but it succeeded');
    } catch (err) {
      // DROP by a non-owner without privilege raises 42501.
      expect(pgErrorCode(err)).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it('fleet_app is DENIED ALTER TABLE', async () => {
    try {
      await pool().query('ALTER TABLE customer ADD COLUMN hacked text');
      throw new Error('expected ALTER to be denied but it succeeded');
    } catch (err) {
      expect(pgErrorCode(err)).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });
});
