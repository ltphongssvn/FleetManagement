// apps/driver-app/test/password-change-client.test.ts
// outside-in strict TDD RED (L0, driver-app boundary): the driver changes
// their own password from the app. The client POSTs currentPassword +
// newPassword to /driver/me/password with the bearer token. The endpoint
// returns 204 No Content on success (no body to parse). On a 401 the current
// password was wrong; the client surfaces that distinctly so the UI can tell
// the driver "current password incorrect" rather than a generic failure.
import { describe, it, expect, vi } from 'vitest';
import { PasswordChangeClient } from '../src/auth/password-change-client.js';
describe('PasswordChangeClient', () => {
  it('POSTs /driver/me/password with bearer token + both passwords', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const client = new PasswordChangeClient({ apiUrl: 'http://api', bearerToken: () => 'tok', fetchFn: fetchFn as never });
    await client.changePassword('oldpass1', 'newpass2');
    expect(fetchFn).toHaveBeenCalledWith(
      'http://api/driver/me/password',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' }),
        body: JSON.stringify({ currentPassword: 'oldpass1', newPassword: 'newpass2' }),
      }),
    );
  });
  it('resolves (no throw) on 204 No Content', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const client = new PasswordChangeClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.changePassword('a', 'bbbbbb')).resolves.toBeUndefined();
  });
  it('throws a distinct current-password error on 401', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });
    const client = new PasswordChangeClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.changePassword('wrong', 'newpass2')).rejects.toThrow(/current password/i);
  });
  it('throws a generic error on other non-ok statuses', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' });
    const client = new PasswordChangeClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.changePassword('a', 'bbbbbb')).rejects.toThrow(/500/);
  });
});
