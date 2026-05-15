// apps/api/test/admin-drivers-create.service.test.ts
// TDD RED: AdminDriversCreateService creates a driver row with bcrypt-hashed
// password, allocates an operatorId, and returns the persisted row.
import { describe, it, expect } from "vitest";
import { AdminDriversCreateService } from "../src/admin/admin-drivers-create.service.js";

interface DriverInsertCapture {
  fullName?: string;
  phone?: string;
  passwordHash?: string;
  operatorId?: string;
  companyId?: string;
  businessUnitId?: string;
  depotId?: string;
  legalEntityId?: string;
  active?: boolean;
}

function makeDb(): { db: unknown; inserts: DriverInsertCapture[] } {
  const inserts: DriverInsertCapture[] = [];
  const db = {
    insert: (): { values: (v: DriverInsertCapture) => { returning: () => Promise<DriverInsertCapture[]> } } => ({
      values: (v: DriverInsertCapture) => ({
        returning: (): Promise<DriverInsertCapture[]> => {
          const row: DriverInsertCapture = { ...v };
          inserts.push(row);
          return Promise.resolve([{ ...row, ...({ driverId: "drv-" + String(inserts.length) } as Partial<DriverInsertCapture>) }]);
        },
      }),
    }),
  };
  return { db, inserts };
}

const tenancy = {
  companyId: "11111111-1111-1111-1111-111111111111",
  businessUnitId: "22222222-2222-2222-2222-222222222222",
  depotId: "33333333-3333-3333-3333-333333333333",
  legalEntityId: "44444444-4444-4444-4444-444444444444",
};

describe("AdminDriversCreateService", () => {
  it("inserts driver with hashed password, allocates operatorId, returns row", async () => {
    const mock = makeDb();
    const svc = new AdminDriversCreateService(mock.db as never);
    const row = await svc.create({
      fullName: "Nguyễn Văn A",
      phone: "+84901000001",
      password: "secret123", // pragma: allowlist secret
      companyId: tenancy.companyId,
      businessUnitId: tenancy.businessUnitId,
      depotId: tenancy.depotId,
      legalEntityId: tenancy.legalEntityId,
    });
    expect(row.driverId).toBeDefined();
    expect(mock.inserts).toHaveLength(1);
    const inserted = mock.inserts[0];
    if (inserted === undefined) throw new Error("no insert captured");
    expect(inserted.fullName).toBe("Nguyễn Văn A");
    expect(inserted.phone).toBe("+84901000001");
    expect(typeof inserted.passwordHash).toBe("string");
    expect(inserted.passwordHash).not.toBe("secret123");
    expect((inserted.passwordHash ?? "").length).toBeGreaterThan(20);
    expect(typeof inserted.operatorId).toBe("string");
    expect((inserted.operatorId ?? "").length).toBeGreaterThan(0);
    expect(inserted.companyId).toBe(tenancy.companyId);
    expect(inserted.active).toBe(true);
  });

  it("each call allocates a distinct operatorId", async () => {
    const mock = makeDb();
    const svc = new AdminDriversCreateService(mock.db as never);
    await svc.create({ fullName: "A", phone: "+84901000002", password: "p1", ...tenancy }); // pragma: allowlist secret
    await svc.create({ fullName: "B", phone: "+84901000003", password: "p1", ...tenancy }); // pragma: allowlist secret
    expect(mock.inserts[0]?.operatorId).not.toBe(mock.inserts[1]?.operatorId);
  });

  it("hashes the same password into different bcrypt hashes (salt is random)", async () => {
    const mock = makeDb();
    const svc = new AdminDriversCreateService(mock.db as never);
    await svc.create({ fullName: "A", phone: "+84901000004", password: "samepw", ...tenancy }); // pragma: allowlist secret
    await svc.create({ fullName: "B", phone: "+84901000005", password: "samepw", ...tenancy }); // pragma: allowlist secret
    expect(mock.inserts[0]?.passwordHash).not.toBe(mock.inserts[1]?.passwordHash);
  });
  it("throws when the DB returns no row (line 49 branch)", async () => {
    const emptyDb = {
      insert: (): { values: (v: unknown) => { returning: () => Promise<unknown[]> } } => ({
        values: () => ({ returning: (): Promise<unknown[]> => Promise.resolve([]) }),
      }),
    };
    const svc = new AdminDriversCreateService(emptyDb as never);
    await expect(svc.create({ fullName: "A", phone: "+84901000099", password: "pw", ...tenancy })).rejects.toThrow(/Driver insert failed/); // pragma: allowlist secret
  });
});
