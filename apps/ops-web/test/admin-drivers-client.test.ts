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

describe("AdminDriversClient.list", () => {
  it("GETs /api/admin/drivers and returns rows", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        // Wire-truthful: GET /admin/drivers always serializes phone (null
        // when unset). The old fixture omitted it and only passed because
        // list() cast instead of parsing -- the boundary now rejects it.
        { driverId: "d1", fullName: "A", phone: null, operatorId: null, assignedVehicle: null, assignmentId: null, devices: [] },
      ]),
    });
    const client = new AdminDriversClient({ apiUrl: "", bearerToken: () => "tok", fetchFn: fetchFn as never });
    const rows = await client.list();
    expect(rows).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledWith("/api/admin/drivers", expect.objectContaining({
      method: "GET",
      headers: expect.objectContaining({ Authorization: "Bearer tok" }),
    }));
  });

  it("throws on non-ok HTTP status", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "err" });
    const client = new AdminDriversClient({ apiUrl: "", bearerToken: () => "tok", fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/500/);
  });

  it("awaits async bearerToken provider", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    const client = new AdminDriversClient({
      apiUrl: "",
      bearerToken: () => Promise.resolve("async-tok"),
      fetchFn: fetchFn as never,
    });
    await client.list();
    expect(fetchFn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer async-tok" }),
    }));
  });

  it("uses globalThis.fetch when fetchFn is not provided", async () => {
    const originalFetch = globalThis.fetch;
    const spy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    globalThis.fetch = spy as never;
    try {
      const client = new AdminDriversClient({ apiUrl: "", bearerToken: () => "tok" });
      await client.list();
      expect(spy).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("AdminDriversClient.assign", () => {
  it("POSTs /api/admin/driver-vehicle-assignments with body and returns assignmentId", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ assignmentId: "aaaa-bbbb" }),
    });
    const client = new AdminDriversClient({ apiUrl: "", bearerToken: () => "tok", fetchFn: fetchFn as never });
    const r = await client.assign({ driverId: "d1", vehicleId: "v1" });
    expect(r.assignmentId).toBe("aaaa-bbbb");
    expect(fetchFn).toHaveBeenCalledWith("/api/admin/driver-vehicle-assignments", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ driverId: "d1", vehicleId: "v1" }),
    }));
  });

  it("throws on non-ok HTTP status", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 409, statusText: "Conflict" });
    const client = new AdminDriversClient({ apiUrl: "", bearerToken: () => "tok", fetchFn: fetchFn as never });
    await expect(client.assign({ driverId: "d1", vehicleId: "v1" })).rejects.toThrow(/409/);
  });

  it("uses globalThis.fetch when fetchFn is not provided", async () => {
    const originalFetch = globalThis.fetch;
    const spy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ assignmentId: "x" }) });
    globalThis.fetch = spy as never;
    try {
      const client = new AdminDriversClient({ apiUrl: "", bearerToken: () => "tok" });
      await client.assign({ driverId: "d1", vehicleId: "v1" });
      expect(spy).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("AdminDriversClient.enrollDevice", () => {
  it("POSTs /api/admin/devices with body and returns deviceId", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ deviceId: "dev-123" }),
    });
    const client = new AdminDriversClient({ apiUrl: "", bearerToken: () => "tok", fetchFn: fetchFn as never });
    const r = await client.enrollDevice({ driverId: "d1", udid: "UDID-A", platform: "ios" });
    expect(r.deviceId).toBe("dev-123");
    expect(fetchFn).toHaveBeenCalledWith("/api/admin/devices", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ driverId: "d1", udid: "UDID-A", platform: "ios" }),
    }));
  });

  it("uses globalThis.fetch when fetchFn is not provided", async () => {
    const originalFetch = globalThis.fetch;
    const spy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ deviceId: "x" }) });
    globalThis.fetch = spy as never;
    try {
      const client = new AdminDriversClient({ apiUrl: "", bearerToken: () => "tok" });
      await client.enrollDevice({ driverId: "d1", udid: "u", platform: "ios" });
      expect(spy).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("AdminDriversClient.revoke", () => {
  it("DELETEs /api/admin/driver-vehicle-assignments/:id with reason in body", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ assignmentId: "a1", revokedAt: "2026-05-13T00:00:00Z" }),
    });
    const client = new AdminDriversClient({ apiUrl: "", bearerToken: () => "tok", fetchFn: fetchFn as never });
    const r = await client.revoke("a1", "driver-quit");
    expect(r.assignmentId).toBe("a1");
    expect(r.revokedAt).toBe("2026-05-13T00:00:00Z");
    expect(fetchFn).toHaveBeenCalledWith("/api/admin/driver-vehicle-assignments/a1", expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({ reason: "driver-quit" }),
    }));
  });

  it("throws on non-ok HTTP status", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" });
    const client = new AdminDriversClient({ apiUrl: "", bearerToken: () => "tok", fetchFn: fetchFn as never });
    await expect(client.revoke("missing", "x")).rejects.toThrow(/404/);
  });

  it("uses globalThis.fetch when fetchFn is not provided", async () => {
    const originalFetch = globalThis.fetch;
    const spy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ assignmentId: "x", revokedAt: "" }) });
    globalThis.fetch = spy as never;
    try {
      const client = new AdminDriversClient({ apiUrl: "", bearerToken: () => "tok" });
      await client.revoke("a", "r");
      expect(spy).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("AdminDriversClient.create — additional branches", () => {
  it("uses globalThis.fetch when fetchFn is not provided", async () => {
    const originalFetch = globalThis.fetch;
    const spy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ driverId: "x", operatorId: "y" }) });
    globalThis.fetch = spy as never;
    try {
      const client = new AdminDriversClient({ apiUrl: "", bearerToken: () => "tok" });
      const r = await client.create({ fullName: "A", phone: "+84901000001", password: "p1" }); // pragma: allowlist secret
      expect(r.driverId).toBe("x");
      expect(spy).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
