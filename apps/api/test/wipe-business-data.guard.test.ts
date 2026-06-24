// apps/api/test/wipe-business-data.guard.test.ts
//
// The CORE defense-in-depth requirement: wipeBusinessData MUST consult the
// production destructive-operation guard ITSELF, so a direct module call (not just
// the CLI entrypoint) cannot wipe production. These tests drive the wiring:
//   - in production with no break-glass, the wipe THROWS and never touches the db
//     (the guard fires BEFORE any TRUNCATE);
//   - in production WITH a production-named break-glass, it proceeds;
//   - in test/development it proceeds unchanged (non-breaking for existing callers).
import { describe, it, expect, vi } from 'vitest';
import { wipeBusinessData } from '../src/maintenance/wipe-business-data.js';
import { DestructiveOperationBlockedError } from '../src/maintenance/destructive-operation-guard.js';

describe('@fleet/api - wipeBusinessData production guard wiring', () => {
  it('THROWS in production with no break-glass and never issues a query', async () => {
    const execute = vi.fn();
    const db = { execute };
    await expect(
      wipeBusinessData(db as never, { environment: 'production', authorization: null }),
    ).rejects.toBeInstanceOf(DestructiveOperationBlockedError);
    // Fail-closed BEFORE any db work: the enumeration query must not have run.
    expect(execute).not.toHaveBeenCalled();
  });

  it('PROCEEDS in production WITH a production-named break-glass', async () => {
    // Enumeration returns no fact tables -> wipe is a no-op AFTER the guard passes.
    const execute = vi.fn().mockResolvedValueOnce({ rows: [] });
    const db = { execute };
    await wipeBusinessData(db as never, {
      environment: 'production',
      authorization: { confirmedEnvironment: 'production', reason: 'approved incident INC-1234 maintenance window' },
    });
    // The guard passed, so the enumeration query ran.
    expect(execute).toHaveBeenCalledOnce();
  });

  it('PROCEEDS in test with no authorization (existing callers unchanged)', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [] });
    const db = { execute };
    await wipeBusinessData(db as never, { environment: 'test' });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('PROCEEDS when called with NO opts under the test runner (back-compat)', async () => {
    // The 7 existing callers pass no opts; under NODE_ENV=test the guard resolves to
    // test and allows. This is the non-breaking contract.
    const execute = vi.fn().mockResolvedValueOnce({ rows: [] });
    const db = { execute };
    await wipeBusinessData(db as never);
    expect(execute).toHaveBeenCalledOnce();
  });
});
