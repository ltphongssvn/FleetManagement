// apps/ops-web/test/admin-drivers-client-boundary-parse.test.ts
// GET /admin/drivers must be PARSED at the trust boundary, not cast.
//
// THE VIOLATION. admin-drivers-client.list() imported the SSOT type and then
// cast the HTTP response to it:
//
//   return (await res.json()) as readonly DriverRow[];
//
// A cast is a promise to the compiler, not a statement about the bytes. Proven
// by the RED run: an object instead of an array, a row carrying only driverId,
// and driverId as a number ALL flowed through untouched to callers typed as
// readonly DriverRow[], surfacing later as undefined property access inside a
// presenter -- far from the cause.
//
// The parser already existed and was written for this exact call site. Its own
// header says so: "parseAdminDriverRows validates ONCE at the HTTP trust
// boundary (replacing the bare res.json() as-cast in admin-drivers-client
// .list)". It shipped to develop; the call site never adopted it. The
// retirement note for feature/co-so-du-lieu recorded this hardening as
// "already shipped via Phase A" -- true of the ensureOk half, not of the parse
// half, which is why the cast survived weeks of everyone believing it fixed.
//
// The fixture below is the FULL wire row. Getting it wrong the first time was
// itself evidence: an incomplete fixture only ever passed because the cast
// validated nothing.
import { describe, it, expect } from 'vitest';
import { AdminDriversClient } from '@/features/admin/admin-drivers-client';

const VALID_ROW = {
  driverId: 'd-1',
  fullName: 'NGUYEN AN BINH DUC',
  phone: '0900000001',
  operatorId: null,
  assignedVehicle: null,
  assignmentId: null,
  devices: [],
};

function clientReturning(payload: unknown): AdminDriversClient {
  const fetchFn = ((): Promise<Response> =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(payload),
    } as Response)) as typeof globalThis.fetch;
  return new AdminDriversClient({ fetchFn });
}

describe('AdminDriversClient.list parses at the boundary', () => {
  it('returns the rows when the payload satisfies the contract', async () => {
    const rows = await clientReturning([VALID_ROW]).list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.driverId).toBe('d-1');
  });

  it('accepts an empty roster', async () => {
    expect(await clientReturning([]).list()).toEqual([]);
  });

  it('accepts a fully-populated row with a vehicle and a device', async () => {
    const rows = await clientReturning([
      {
        ...VALID_ROW,
        assignedVehicle: { vehicleId: 'v-1', plate: '62H-06209' },
        assignmentId: 'a-1',
        devices: [
          { deviceId: 'dev-1', platform: 'android', appVersion: '1.2.3', lastSeenAt: null },
        ],
      },
    ]).list();
    expect(rows[0]?.assignedVehicle?.plate).toBe('62H-06209');
    expect(rows[0]?.devices).toHaveLength(1);
  });

  it('REJECTS a payload that is not an array', async () => {
    await expect(clientReturning({ rows: [VALID_ROW] }).list()).rejects.toThrow();
  });

  it('REJECTS a row missing a required field', async () => {
    await expect(clientReturning([{ driverId: 'd-1' }]).list()).rejects.toThrow();
  });

  it('REJECTS a row whose field has the wrong type', async () => {
    await expect(clientReturning([{ ...VALID_ROW, driverId: 42 }]).list()).rejects.toThrow();
  });

  // nullable is NOT optional: the key must be present. An absent phone is what
  // the pre-existing fixture assumed was legal, and the contract disagrees.
  it('REJECTS a row with phone absent rather than null', async () => {
    const { phone: _omitted, ...withoutPhone } = VALID_ROW;
    await expect(clientReturning([withoutPhone]).list()).rejects.toThrow();
  });

  // Forward compatibility: looseObject on purpose, so a newer producer adding
  // a member must not break an older consumer.
  it('tolerates unknown members a newer producer may add', async () => {
    const rows = await clientReturning([{ ...VALID_ROW, futureField: 'x' }]).list();
    expect(rows[0]?.driverId).toBe('d-1');
  });
});
