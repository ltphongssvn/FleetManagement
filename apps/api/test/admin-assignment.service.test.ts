// apps/api/test/admin-assignment.service.test.ts
// RED: AdminAssignmentService creates and revokes driver-vehicle assignments.
import { describe, it, expect, beforeEach } from 'vitest';
import { AdminAssignmentService } from '../src/admin/admin-assignment.service.js';

interface MockRow { assignmentId: string; driverId: string; vehicleId: string; companyId: string; revokedAt: Date | null; revocationReason: string | null; }

function makeDb(): { db: unknown; rows: MockRow[] } {
  const rows: MockRow[] = [];
  const db = {
    insert: () => ({
      values: (v: Partial<MockRow>): { returning: () => Promise<MockRow[]> } => ({
        returning: (): Promise<MockRow[]> => {
          const row: MockRow = {
            assignmentId: 'asg-' + String(rows.length + 1),
            driverId: v.driverId ?? "",
            vehicleId: v.vehicleId ?? "",
            companyId: v.companyId ?? "",
            revokedAt: null,
            revocationReason: null,
          };
          rows.push(row);
          return Promise.resolve([row]);
        },
      }),
    }),
    update: () => ({
      set: (s: Partial<MockRow>) => ({
        where: () => ({
          returning: (): Promise<MockRow[]> => {
            const r = rows.find((x) => x.assignmentId === 'asg-1' && x.revokedAt === null);
            if (!r) return Promise.resolve([]);
            r.revokedAt = s.revokedAt ?? new Date();
            r.revocationReason = s.revocationReason ?? null;
            return Promise.resolve([r]);
          },
        }),
      }),
    }),
  };
  return { db, rows };
}

describe('AdminAssignmentService', () => {
  const tenancy = {
    companyId: '11111111-1111-1111-1111-111111111111',
    businessUnitId: '22222222-2222-2222-2222-222222222222',
    depotId: '33333333-3333-3333-3333-333333333333',
    legalEntityId: '44444444-4444-4444-4444-444444444444',
  };
  let mock: ReturnType<typeof makeDb>;
  let svc: AdminAssignmentService;

  beforeEach(() => {
    mock = makeDb();
    svc = new AdminAssignmentService(mock.db as never);
  });

  it('assigns a driver to a vehicle', async () => {
    const r = await svc.assign({ driverId: 'd1', vehicleId: 'v1', ...tenancy });
    expect(r.assignmentId).toBe('asg-1');
    expect(r.revokedAt).toBeNull();
  });

  it('revokes an assignment with reason', async () => {
    await svc.assign({ driverId: 'd1', vehicleId: 'v1', ...tenancy });
    const r = await svc.revoke({ assignmentId: 'asg-1', reason: 'driver_left' });
    expect(r.revokedAt).not.toBeNull();
    expect(r.revocationReason).toBe('driver_left');
  });
});
