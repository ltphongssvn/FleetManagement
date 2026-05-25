// apps/api/test/wipe-business-data.empty.test.ts
//
// Branch coverage for the early-return guard in wipe-business-data.ts:
//   if (tables.length === 0) return;
// Defensive: pg_tables query returns no rows when the public schema is
// empty. We mock the db to assert wipeBusinessData is a no-op in that
// case (no TRUNCATE issued).
import { describe, it, expect, vi } from 'vitest';
import { wipeBusinessData } from '../src/maintenance/wipe-business-data.js';
describe('@fleet/api - wipeBusinessData empty-schema guard', () => {
  it('is a no-op when pg_tables returns no rows (line 39 guard)', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [] });
    const db = { execute };
    await wipeBusinessData(db as never);
    // Only the enumeration query is issued; no TRUNCATE follows.
    expect(execute).toHaveBeenCalledOnce();
  });
});
