// apps/ops-web/test/admin-drivers-client-reset-password.test.ts
// TDD RED: AdminDriversClient.resetPassword POSTs {newPassword} to
// /api/admin/drivers/:id/reset-password (service-desk reset; no current
// password) and resolves on the 204. Mirrors the existing client tests:
// asserts URL + method + Authorization + body, the non-ok throw, and the
// globalThis.fetch fallback (for the 90/90/90/90 branch gate).
import { describe, it, expect, vi } from "vitest";
import { AdminDriversClient } from "../src/features/admin/admin-drivers-client";

describe("AdminDriversClient.resetPassword", () => {
  it("POSTs /api/admin/drivers/:id/reset-password with {newPassword} and resolves on 204", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const client = new AdminDriversClient({
      apiUrl: "",
      bearerToken: () => "tok",
      fetchFn: fetchFn as never,
    });
    await client.resetPassword("d1", "newpass1"); // pragma: allowlist secret
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/admin/drivers/d1/reset-password",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer tok",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ newPassword: "newpass1" }), // pragma: allowlist secret
      }),
    );
  });

  it("throws on non-ok HTTP status", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 400, statusText: "Bad Request" });
    const client = new AdminDriversClient({ apiUrl: "", bearerToken: () => "tok", fetchFn: fetchFn as never });
    await expect(client.resetPassword("d1", "short")).rejects.toThrow(/400/); // pragma: allowlist secret
  });

  it("awaits async bearerToken provider", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const client = new AdminDriversClient({
      apiUrl: "",
      bearerToken: () => Promise.resolve("async-tok"),
      fetchFn: fetchFn as never,
    });
    await client.resetPassword("d1", "newpass1"); // pragma: allowlist secret
    expect(fetchFn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer async-tok" }),
    }));
  });

  it("uses globalThis.fetch when fetchFn is not provided", async () => {
    const originalFetch = globalThis.fetch;
    const spy = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    globalThis.fetch = spy as never;
    try {
      const client = new AdminDriversClient({ apiUrl: "", bearerToken: () => "tok" });
      await client.resetPassword("d1", "newpass1"); // pragma: allowlist secret
      expect(spy).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
