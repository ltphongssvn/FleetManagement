// apps/api/test/order-sequence-default-padwidth.integration.test.ts
// L5 invariant (2026-Q2): the order_sequence column-level DEFAULT for
// pad_width must be 3 to match the XTT.MM-NNN external_ref contract enforced
// by the timestamped order-number-seq migration. A schema default of 3
// would let a future tenant get an XTT.MM-NNN allocator inconsistent with the
// pilot company. The default is the failsafe when neither the seed nor
// the timestamped migration is responsible (e.g. dynamic INSERT paths).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { orderSequence } from '../src/database/schema/reference.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
let testDb: PgliteTestDb;
describe('@fleet/api - order_sequence schema-level pad_width default', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 60_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('inserts a row WITHOUT pad_width and the column default lands on 4', async () => {
    await testDb.db.insert(orderSequence).values({
      companyId: COMPANY_ID,
      businessUnitId: COMPANY_ID,
      depotId: COMPANY_ID,
      legalEntityId: COMPANY_ID,
      prefix: 'PROBE',
      // nextValue and padWidth intentionally omitted so the DB default applies.
    });
    const [row] = await testDb.db
      .select({ padWidth: orderSequence.padWidth })
      .from(orderSequence)
      .where(and(eq(orderSequence.companyId, COMPANY_ID), eq(orderSequence.prefix, 'PROBE')));
    expect(row?.padWidth).toBe(3);
  });
});
