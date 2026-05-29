// apps/api/test/admin-drivers-create.controller.test.ts
// TDD RED: POST /admin/drivers accepts {fullName, phone, password}, returns
// {driverId, operatorId}. Tenancy scope comes from JWT (CurrentOperator).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AdminDriversCreateController } from "../src/admin/admin-drivers-create.controller.js";
import type { AdminDriversCreateService } from "../src/admin/admin-drivers-create.service.js";
import type { OperatorContext } from "@fleet/domain";

const op: OperatorContext = {
  operatorId: "00000000-0000-0000-0000-0000000000aa",
  companyId: "11111111-1111-1111-1111-111111111111",
  businessUnitId: "22222222-2222-2222-2222-222222222222",
  depotId: "33333333-3333-3333-3333-333333333333",
  legalEntityId: "44444444-4444-4444-4444-444444444444",
};

describe("AdminDriversCreateController", () => {
  let createFn: ReturnType<typeof vi.fn>;
  let controller: AdminDriversCreateController;

  beforeEach(() => {
    createFn = vi.fn();
    controller = new AdminDriversCreateController({ create: createFn } as unknown as AdminDriversCreateService);
  });

  it("POST /admin/drivers creates a driver and returns ids", async () => {
    createFn.mockResolvedValue({
      driverId: "55555555-5555-5555-5555-555555555555",
      operatorId: "66666666-6666-6666-6666-666666666666",
      fullName: "Nguyễn Văn A",
      phone: "+84901000001",
      companyId: op.companyId,
    });
    const r = await controller.create(op, {
      fullName: "Nguyễn Văn A",
      phone: "+84901000001",
      password: "secret123", // pragma: allowlist secret
    });
    expect(r.driverId).toBe("55555555-5555-5555-5555-555555555555");
    expect(r.operatorId).toBe("66666666-6666-6666-6666-666666666666");
    expect(createFn).toHaveBeenCalledWith(expect.objectContaining({
      fullName: "Nguyễn Văn A",
      phone: "+84901000001",
      password: "secret123", // pragma: allowlist secret
      companyId: op.companyId,
      businessUnitId: op.businessUnitId,
      depotId: op.depotId,
      legalEntityId: op.legalEntityId,
    }));
  });

  it("rejects invalid body (missing fullName)", async () => {
    await expect(controller.create(op, { phone: "+84901000001", password: "p" } as never)).rejects.toThrow();
  });

  it("rejects invalid body (password too short)", async () => {
    await expect(controller.create(op, { fullName: "A", phone: "+84901000001", password: "x" })).rejects.toThrow();
  });

  it("rejects invalid body (phone too short)", async () => {
    await expect(controller.create(op, { fullName: "A", phone: "1", password: "secret123" })).rejects.toThrow(); // pragma: allowlist secret
  });
});
