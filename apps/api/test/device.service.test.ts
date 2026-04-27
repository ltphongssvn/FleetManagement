// apps/api/test/device.service.test.ts
// Behavior tests for DeviceService using vitest-mock-extended.
// Real Postgres concurrency tests live in test/device.service.integration.test.ts.
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

function setupDb(opts: {
  insertReturning?: unknown[];
  insertThrows?: unknown;
  selectResults?: unknown[][];
  updateReturning?: unknown[];
}): DeepMockProxy<FleetDb> {
  const db = mockDeep<FleetDb>();
  const selectQueue = [...(opts.selectResults ?? [])];

  db.insert.mockImplementation(() => ({
    values: () => ({
      returning: () => {
        if (opts.insertThrows !== undefined) {
          return Promise.reject(opts.insertThrows as Error);
        }
        return Promise.resolve(opts.insertReturning ?? []);
      },
    }),
  }) as never);

  db.select.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(selectQueue.shift() ?? []),
      }),
    }),
  }) as never);

  db.update.mockImplementation(() => ({
    set: () => ({
      where: () => ({ returning: () => Promise.resolve(opts.updateReturning ?? []) }),
    }),
  }) as never);

  return db;
}

describe('@fleet/api - DeviceService.issueSession', () => {
  it('issues a mutating session via blind insert', async () => {
    const db = setupDb({ insertReturning: [issuedRow] });
    const service = new DeviceService(db);
    const result = await service.issueSession(validInput);
    expect(result.deviceSessionId).toBe(issuedRow.deviceSessionId);
  });

  it('translates Postgres 23505 unique violation to ConflictException', async () => {
    const pgErr = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'device_session_one_mutating_per_operator_surface_uq',
    });
    const db = setupDb({ insertThrows: pgErr });
    const service = new DeviceService(db);
    await expect(service.issueSession(validInput)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rethrows non-unique-violation DB errors', async () => {
    const otherErr = Object.assign(new Error('undefined_table'), { code: '42P01' });
    const db = setupDb({ insertThrows: otherErr });
    const service = new DeviceService(db);
    await expect(service.issueSession(validInput)).rejects.toEqual(otherErr);
  });

  it('issues a shadow session', async () => {
    const db = setupDb({ insertReturning: [{ ...issuedRow, sessionMode: 'shadow' }] });
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
    const db = setupDb({ updateReturning: [revokedRow] });
    const service = new DeviceService(db);
    const result = await service.revokeSession(issuedRow.deviceSessionId, 'admin_revoke');
    expect(result.revocationReason).toBe('admin_revoke');
  });

  it('returns existing row when already revoked (idempotent)', async () => {
    const alreadyRevoked = { ...issuedRow, revokedAt: new Date(), revocationReason: 'shift_end' };
    const db = setupDb({ updateReturning: [], selectResults: [[alreadyRevoked]] });
    const service = new DeviceService(db);
    const result = await service.revokeSession(issuedRow.deviceSessionId, 'admin_revoke');
    expect(result.revocationReason).toBe('shift_end');
  });

  it('throws NotFoundException when session does not exist', async () => {
    const db = setupDb({ updateReturning: [], selectResults: [[]] });
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
    const db = setupDb({ selectResults: [[issuedRow]] });
    const service = new DeviceService(db);
    const result = await service.findActiveSession(issuedRow.deviceSessionId);
    expect(result?.deviceSessionId).toBe(issuedRow.deviceSessionId);
  });

  it('returns null when no active session', async () => {
    const db = setupDb({ selectResults: [[]] });
    const service = new DeviceService(db);
    const result = await service.findActiveSession('missing-id');
    expect(result).toBeNull();
  });
});

describe('@fleet/api - DeviceService.deviceExists', () => {
  it('returns true when device registered', async () => {
    const db = setupDb({ selectResults: [[{ id: validInput.deviceId }]] });
    const service = new DeviceService(db);
    expect(await service.deviceExists(validInput.deviceId)).toBe(true);
  });

  it('returns false when device unknown', async () => {
    const db = setupDb({ selectResults: [[]] });
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
