// apps/api/test/device-enrollment.service.test.ts
// RED: DeviceEnrollmentService.enroll() upserts device_registry by (operatorId, platform).
// Idempotent: same operator re-enrolling same device returns existing row.
import { describe, it, expect, beforeEach } from 'vitest';
import { DeviceEnrollmentService } from '../src/device/device-enrollment.service.js';

interface MockRow { deviceId: string; operatorId: string; platform: string; appVersion: string; }

function makeDb(): { db: unknown; inserts: MockRow[]; updates: MockRow[] } {
  const inserts: MockRow[] = [];
  const updates: MockRow[] = [];
  const db = {
    insert: () => ({
      values: (v: MockRow) => ({
        onConflictDoUpdate: (_: unknown) => ({
          returning: (): Promise<MockRow[]> => {
            const existing = inserts.find((r) => r.operatorId === v.operatorId && r.platform === v.platform);
            if (existing) {
              existing.appVersion = v.appVersion;
              updates.push(existing);
              return Promise.resolve([existing]);
            }
            const row = { ...v, deviceId: 'dev-' + String(inserts.length + 1) };
            inserts.push(row);
            return Promise.resolve([row]);
          },
        }),
      }),
    }),
  };
  return { db, inserts, updates };
}

describe('DeviceEnrollmentService', () => {
  let mock: ReturnType<typeof makeDb>;
  let svc: DeviceEnrollmentService;
  const op = '00000000-0000-0000-0000-0000000000aa';
  const tenancy = {
    companyId: '11111111-1111-1111-1111-111111111111',
    businessUnitId: '22222222-2222-2222-2222-222222222222',
    depotId: '33333333-3333-3333-3333-333333333333',
    legalEntityId: '44444444-4444-4444-4444-444444444444',
  };

  beforeEach(() => {
    mock = makeDb();
    svc = new DeviceEnrollmentService(mock.db as never);
  });

  it('first enrollment inserts a new device_registry row', async () => {
    const r = await svc.enroll({ operatorId: op, platform: 'ios', appVersion: '0.1.0', ...tenancy });
    expect(r.deviceId).toBe('dev-1');
    expect(mock.inserts).toHaveLength(1);
  });

  it('re-enrollment on same platform is idempotent (returns same deviceId)', async () => {
    const r1 = await svc.enroll({ operatorId: op, platform: 'ios', appVersion: '0.1.0', ...tenancy });
    const r2 = await svc.enroll({ operatorId: op, platform: 'ios', appVersion: '0.1.1', ...tenancy });
    expect(r2.deviceId).toBe(r1.deviceId);
    expect(mock.updates).toHaveLength(1);
  });

  it('different platforms produce distinct devices for same operator', async () => {
    const ios = await svc.enroll({ operatorId: op, platform: 'ios', appVersion: '0.1.0', ...tenancy });
    const android = await svc.enroll({ operatorId: op, platform: 'android', appVersion: '0.1.0', ...tenancy });
    expect(ios.deviceId).not.toBe(android.deviceId);
  });
});
