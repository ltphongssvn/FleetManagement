// apps/ops-web/test/admin-drivers-client.test.ts
// TDD RED: AdminDriversClient.create posts {fullName, phone, password} to
// the BFF and returns {driverId, operatorId}.
import { describe, it, expect, vi } from "vitest";
import { AdminDriversClient } from "../src/features/admin/admin-drivers-client";

describe("AdminDriversClient.create", () => {
  it("POSTs /api/admin/drivers with body and returns ids", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        driverId: "55555555-5555-5555-5555-555555555555",
        operatorId: "66666666-6666-6666-6666-666666666666",
      }),
    });
    const client = new AdminDriversClient({
      apiUrl: "",
      bearerToken: () => "tok",
      fetchFn: fetchFn as never,
    });
    const r = await client.create({
      fullName: "Nguyễn Văn A",
      phone: "+84901000001",
      password: "secret123", // pragma: allowlist secret
    });
    expect(r.driverId).toBe("55555555-5555-5555-5555-555555555555");
    expect(r.operatorId).toBe("66666666-6666-6666-6666-666666666666");
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/admin/drivers",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer tok",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          fullName: "Nguyễn Văn A",
          phone: "+84901000001",
          password: "secret123", // pragma: allowlist secret
        }),
      }),
    );
  });

  it("throws on non-ok HTTP status", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 400, statusText: "Bad Request" });
    const client = new AdminDriversClient({
      apiUrl: "",
      bearerToken: () => "tok",
      fetchFn: fetchFn as never,
    });
    await expect(
      client.create({ fullName: "A", phone: "+84901000001", password: "p1" }), // pragma: allowlist secret
    ).rejects.toThrow(/400/);
  });
});
