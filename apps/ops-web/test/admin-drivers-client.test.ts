// apps/ops-web/test/admin-drivers-client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AdminDriversClient } from '../src/features/admin/admin-drivers-client.js';

describe('AdminDriversClient', () => {
  it('GETs /admin/drivers with bearer token', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ driverId: 'd1', fullName: 'A', operatorId: null, assignedVehicle: null, assignmentId: null, devices: [] }]),
    });
    const client = new AdminDriversClient({ apiUrl: 'http://api', bearerToken: () => 'tok', fetchFn });
    const rows = await client.list();
    expect(rows).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledWith('/api/admin/drivers', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
    }));
  });

  it('POSTs to /admin/driver-vehicle-assignments to assign', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ assignmentId: 'a1' }) });
    const client = new AdminDriversClient({ apiUrl: 'http://api', bearerToken: () => 'tok', fetchFn });
    const r = await client.assign({ driverId: 'd1', vehicleId: 'v1' });
    expect(r.assignmentId).toBe('a1');
    expect(fetchFn).toHaveBeenCalledWith('/api/admin/driver-vehicle-assignments', expect.objectContaining({ method: 'POST' }));
  });

  it('DELETEs /admin/driver-vehicle-assignments/:id to revoke', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ assignmentId: 'a1', revokedAt: '2026-05-11T00:00:00Z' }) });
    const client = new AdminDriversClient({ apiUrl: 'http://api', bearerToken: () => 'tok', fetchFn });
    const r = await client.revoke('a1', 'driver_left');
    expect(r.assignmentId).toBe('a1');
    expect(fetchFn).toHaveBeenCalledWith('/api/admin/driver-vehicle-assignments/a1', expect.objectContaining({ method: 'DELETE' }));
  });
});
