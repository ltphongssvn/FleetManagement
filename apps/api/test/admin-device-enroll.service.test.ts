// apps/api/test/admin-device-enroll.service.test.ts
// RED: AdminDeviceEnrollService enrolls a device for a driver by udid + platform.
import { describe, it, expect, beforeEach } from 'vitest';
import { AdminDeviceEnrollService } from '../src/admin/admin-device-enroll.service.js';

interface DriverRow { driverId: string; operatorId: string | null; companyId: string; businessUnitId: string; depotId: string; legalEntityId: string; }
interface DevRow { deviceId: string; operatorId: string; platform: string; appVersion: string; udid: string; companyId: string; }

function makeDb(drivers: DriverRow[]): { db: unknown; inserts: DevRow[] } {
  const inserts: DevRow[] = [];
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(drivers) }) }) }),
    insert: () => ({
      values: (v: Partial<DevRow>) => ({
        onConflictDoUpdate: () => ({
          returning: () => {
            const row: DevRow = {
              deviceId: 'dev-' + String(inserts.length + 1),
              operatorId: v.operatorId ?? '',
              platform: v.platform ?? '',
              appVersion: v.appVersion ?? '',
              udid: v.udid ?? '',
              companyId: v.companyId ?? '',
            };
            inserts.push(row);
            return Promise.resolve([row]);
          },
        }),
      }),
    }),
  };
  return { db, inserts };
}

describe('AdminDeviceEnrollService', () => {
  const tenancy = {
    companyId: '11111111-1111-1111-1111-111111111111',
    businessUnitId: '22222222-2222-2222-2222-222222222222',
    depotId: '33333333-3333-3333-3333-333333333333',
    legalEntityId: '44444444-4444-4444-4444-444444444444',
  };

  it('looks up driver.operatorId and enrolls device with udid', async () => {
    const drivers: DriverRow[] = [{ driverId: 'd1', operatorId: 'op-1', ...tenancy }];
    const mock = makeDb(drivers);
    const svc = new AdminDeviceEnrollService(mock.db as never);
    const r = await svc.enroll({ driverId: 'd1', udid: '00008110-000624200CFA201E', platform: 'ios', companyId: tenancy.companyId });
    expect(r.deviceId).toBe('dev-1');
    expect(mock.inserts[0]?.udid).toBe('00008110-000624200CFA201E');
    expect(mock.inserts[0]?.operatorId).toBe('op-1');
  });

  it('throws when driver has no operatorId', async () => {
    const drivers: DriverRow[] = [{ driverId: 'd1', operatorId: null, ...tenancy }];
    const mock = makeDb(drivers);
    const svc = new AdminDeviceEnrollService(mock.db as never);
    await expect(svc.enroll({ driverId: 'd1', udid: 'x', platform: 'ios', companyId: tenancy.companyId })).rejects.toThrow();
  });
});
