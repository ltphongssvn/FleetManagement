// apps/ops-web/test/admin-drivers-client-boundary-parse.test.ts
// Schema-first arc, AXIS 1 -- trust boundary.
//
// AdminDriversClient.list() consumed GET /admin/drivers by casting
// res.json() as DriverRow[]. That endpoint is an HTTP trust boundary, so the
// payload is untrusted and MUST be Zod-validated there. The SSOT ships the
// validator -- parseAdminDriverRows in driver-attention-contract, whose header
// says it exists to replace this very cast -- but it had ZERO production
// callers, so the boundary was documented-closed yet actually open.
//
// Consequence the cast hid (the t5b failure mode): a producer that renames or
// drops a member enters React state as a well-typed lie and surfaces as an
// undefined read deep in a cell renderer, far from the cause. A boundary parse
// turns that into one loud, local load error; DriversSection already renders
// its handled error state on a rejected promise.
//
// Transport note: after the T11/idle-timeout arc the client authenticates via
// the httpOnly fleet_session cookie and raises non-ok through ensureOk, so
// these fixtures need no Authorization header; the parse runs AFTER ensureOk
// has cleared transport, on a 2xx body that is still shape-untrusted.
import { describe, it, expect, vi } from 'vitest';
import { AdminDriversClient } from '../src/features/admin/admin-drivers-client';
const VALID_ROW = {
  driverId: 'd1',
  fullName: 'Nguyễn Văn A',
  phone: '+84901000001',
  operatorId: 'op-1',
  assignedVehicle: { vehicleId: 'v1', plate: '62H 05194' },
  assignmentId: 'asg-1',
  devices: [
    { deviceId: 'dev-1', platform: 'ios', appVersion: '1.2.3', lastSeenAt: null, udid: 'UDID-A' },
  ],
};
function clientWith(json: unknown, ok = true, status = 200): AdminDriversClient {
  const fetchFn = vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(json) });
  return new AdminDriversClient({ fetchFn: fetchFn as never });
}
describe('AdminDriversClient.list parses at the trust boundary', () => {
  it('returns rows for a wire-truthful payload', async () => {
    const rows = await clientWith([VALID_ROW]).list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.driverId).toBe('d1');
    expect(rows[0]?.assignedVehicle?.plate).toBe('62H 05194');
  });
  it('keeps unknown members (looseObject: newer producer, older consumer)', async () => {
    const rows = await clientWith([{ ...VALID_ROW, futureMember: 42 }]).list();
    expect(rows).toHaveLength(1);
  });
  it('rejects a row with a missing required member instead of casting it', async () => {
    const { phone: _dropped, ...noPhone } = VALID_ROW;
    await expect(clientWith([noPhone]).list()).rejects.toThrow(/hợp lệ|invalid|schema/i);
  });
  it('rejects a row with a wrong-typed member', async () => {
    await expect(clientWith([{ ...VALID_ROW, driverId: 42 }]).list()).rejects.toThrow();
  });
  it('rejects a non-array envelope', async () => {
    await expect(clientWith({ rows: [VALID_ROW] }).list()).rejects.toThrow();
  });
  it('rejects null', async () => {
    await expect(clientWith(null).list()).rejects.toThrow();
  });
  it('still accepts a legitimately empty fleet', async () => {
    await expect(clientWith([]).list()).resolves.toEqual([]);
  });
});
