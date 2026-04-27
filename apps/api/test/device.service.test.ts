// apps/api/test/device.service.test.ts
/* eslint-disable @typescript-eslint/unbound-method */
// Behavior tests for DeviceService using vitest-mock-extended.
// Real Postgres integration arrives Week 8 with Testcontainers per PDF.
import { describe, it, expect } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DeviceService, type IssueSessionInput } from '../src/device/device.service.js';
import type { FleetDb } from '../src/database/database.module.js';
import type { DeviceSession } from '../src/database/schema/device.js';

const validInput: IssueSessionInput = {
  deviceId: '00000000-0000-0000-0000-000000000001',
  operatorId: '00000000-0000-0000-0000-000000000002',
  surface: 'road',
  sessionMode: 'mutating',
  companyId: '00000000-0000-0000-0000-000000000003',
  businessUnitId: '00000000-0000-0000-0000-000000000004',
  depotId: '00000000-0000-0000-0000-000000000005',
  legalEntityId: '00000000-0000-0000-0000-000000000006',
};

const issuedRow = {
  deviceSessionId: '00000000-0000-0000-0000-00000000000a',
  ...validInput,
  issuedAt: new Date(),
  revokedAt: null,
  revocationReason: null,
  revocationReasonSchemaVersion: null,
  tokenConsumedAt: null,
} satisfies DeviceSession;

/**
 * Build a DeepMockProxy<FleetDb> that lets tests script select/insert/update
 * results via the fluent Drizzle API without hand-coding chains.
 */
function setupDb(opts: {
  txSelectResults?: unknown[][];
  txInsertReturning?: unknown[];
  outerSelectResults?: unknown[][];
  outerUpdateReturning?: unknown[];
}): DeepMockProxy<FleetDb> {
  const db = mockDeep<FleetDb>();

  // Transaction passes a tx object with same select/insert API
  db.transaction.mockImplementation((async (fn: (tx: FleetDb) => Promise<unknown>) => {
    const tx = mockDeep<FleetDb>();
    const txSelectQueue = [...(opts.txSelectResults ?? [])];
    tx.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(txSelectQueue.shift() ?? []),
        }),
      }),
    }) as never);
    tx.insert.mockImplementation(() => ({
      values: () => ({ returning: () => Promise.resolve(opts.txInsertReturning ?? []) }),
    }) as never);
    return fn(tx);
  }) as never);

  const outerSelectQueue = [...(opts.outerSelectResults ?? [])];
  db.select.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(outerSelectQueue.shift() ?? []),
      }),
    }),
  }) as never);

  db.update.mockImplementation(() => ({
    set: () => ({
      where: () => ({ returning: () => Promise.resolve(opts.outerUpdateReturning ?? []) }),
    }),
  }) as never);

  return db;
}

describe('@fleet/api - DeviceService.issueSession', () => {
  it('issues a mutating session when none active', async () => {
    const db = setupDb({ txSelectResults: [[]], txInsertReturning: [issuedRow] });
    const service = new DeviceService(db);
    const result = await service.issueSession(validInput);
    expect(result.deviceSessionId).toBe(issuedRow.deviceSessionId);
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it('rejects mutating session when active one exists', async () => {
    const db = setupDb({ txSelectResults: [[{ id: 'existing' }]] });
    const service = new DeviceService(db);
    await expect(service.issueSession(validInput)).rejects.toBeInstanceOf(ConflictException);
  });

  it('skips uniqueness check for shadow sessions', async () => {
    const db = setupDb({ txInsertReturning: [{ ...issuedRow, sessionMode: 'shadow' }] });
    const service = new DeviceService(db);
    const result = await service.issueSession({ ...validInput, sessionMode: 'shadow' });
    expect(result.sessionMode).toBe('shadow');
  });

  it('rejects invalid surface via Zod schema', async () => {
    const db = setupDb({});
    const service = new DeviceService(db);
    await expect(
      service.issueSession({ ...validInput, surface: 'admin' as never }),
    ).rejects.toThrow();
  });
});

describe('@fleet/api - DeviceService.revokeSession', () => {
  it('revokes an active session', async () => {
    const revokedRow = { ...issuedRow, revokedAt: new Date(), revocationReason: 'admin_revoke' };
    const db = setupDb({ outerUpdateReturning: [revokedRow] });
    const service = new DeviceService(db);
    const result = await service.revokeSession(issuedRow.deviceSessionId, 'admin_revoke');
    expect(result.revocationReason).toBe('admin_revoke');
  });

  it('returns existing row when already revoked (idempotent)', async () => {
    const alreadyRevoked = { ...issuedRow, revokedAt: new Date(), revocationReason: 'shift_end' };
    const db = setupDb({ outerUpdateReturning: [], outerSelectResults: [[alreadyRevoked]] });
    const service = new DeviceService(db);
    const result = await service.revokeSession(issuedRow.deviceSessionId, 'admin_revoke');
    expect(result.revocationReason).toBe('shift_end');
  });

  it('throws NotFoundException when session does not exist', async () => {
    const db = setupDb({ outerUpdateReturning: [], outerSelectResults: [[]] });
    const service = new DeviceService(db);
    await expect(service.revokeSession('missing-id', 'admin_revoke')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects invalid revocation reason via Zod', async () => {
    const db = setupDb({});
    const service = new DeviceService(db);
    await expect(
      service.revokeSession(issuedRow.deviceSessionId, 'invented_reason' as never),
    ).rejects.toThrow();
  });
});

describe('@fleet/api - DeviceService.findActiveSession', () => {
  it('returns row when active session exists', async () => {
    const db = setupDb({ outerSelectResults: [[issuedRow]] });
    const service = new DeviceService(db);
    const result = await service.findActiveSession(issuedRow.deviceSessionId);
    expect(result?.deviceSessionId).toBe(issuedRow.deviceSessionId);
  });

  it('returns null when no active session', async () => {
    const db = setupDb({ outerSelectResults: [[]] });
    const service = new DeviceService(db);
    const result = await service.findActiveSession('missing-id');
    expect(result).toBeNull();
  });
});

describe('@fleet/api - DeviceService.deviceExists', () => {
  it('returns true when device registered', async () => {
    const db = setupDb({ outerSelectResults: [[{ id: validInput.deviceId }]] });
    const service = new DeviceService(db);
    expect(await service.deviceExists(validInput.deviceId)).toBe(true);
  });

  it('returns false when device unknown', async () => {
    const db = setupDb({ outerSelectResults: [[]] });
    const service = new DeviceService(db);
    expect(await service.deviceExists('unknown')).toBe(false);
  });
});

describe('@fleet/api - DeviceService.getSupportedModes', () => {
  it('exposes domain SESSION_MODES', () => {
    const db = setupDb({});
    const service = new DeviceService(db);
    expect(service.getSupportedModes()).toContain('mutating');
    expect(service.getSupportedModes()).toContain('shadow');
  });
});
