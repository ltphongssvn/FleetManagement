// apps/ops-web/test/admin-drivers-client-boundary-parse.test.ts
// RED-first (schema-first arc, AXIS 1 -- trust boundary).
//
// AdminDriversClient.list() casts: return (await res.json()) as DriverRow[].
// GET /admin/drivers is an HTTP trust boundary, so the payload is untrusted
// and MUST be Zod-validated there. The SSOT already ships the validator --
// parseAdminDriverRows in driver-attention-contract, whose own header says it
// exists to replace this very cast -- but it has ZERO production callers, so
// the boundary was never actually closed. driver-attention.machine.ts even
// documents that it trusts rows parsed by the client; today nothing parses.
//
// Consequence the cast hides: a producer that renames or drops a member (the
// t5b failure mode) enters React state as a well-typed lie and surfaces as an
// undefined read deep in a cell renderer, far from the cause. A boundary parse
// turns that into one loud, local load error.
//
// Contract driven here: a shape-invalid payload is an ERROR, not data. list()
// throws; DriversSection already renders its error state (Khong tai duoc danh
// sach tai xe) on a rejected promise, so the failure is handled, not a crash.
//
// enrollDevice never checks res.ok -- it parses the body of a 4xx/5xx as if it
// were a success envelope and hands back an undefined deviceId. Every sibling
// method throws on non-ok; this one is the outlier.
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
  return new AdminDriversClient({ apiUrl: '', bearerToken: () => 'tok', fetchFn: fetchFn as never });
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
describe('AdminDriversClient.enrollDevice checks the response status', () => {
  it('throws on non-ok instead of parsing the error body as a device', async () => {
    await expect(
      clientWith({ statusCode: 409, message: 'UDID đã tồn tại' }, false, 409)
        .enrollDevice({ driverId: 'd1', udid: 'UDID-A', platform: 'ios' }),
    ).rejects.toThrow(/409/);
  });
  it('still returns the deviceId on success', async () => {
    const r = await clientWith({ deviceId: 'dev-9' })
      .enrollDevice({ driverId: 'd1', udid: 'UDID-A', platform: 'ios' });
    expect(r.deviceId).toBe('dev-9');
  });
});
