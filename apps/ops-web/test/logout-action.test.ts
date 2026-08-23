// apps/ops-web/test/logout-action.test.ts
// RED: logout deletes fleet_session cookie and redirects to /login.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const cookieDelete = vi.fn();
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ delete: cookieDelete, set: vi.fn(), get: vi.fn() }),
}));
const redirect = vi.fn(() => {
  throw new Error('NEXT_REDIRECT');
});
vi.mock('next/navigation', () => ({ redirect }));
describe('logout server action', () => {
  beforeEach(() => {
    cookieDelete.mockClear();
    redirect.mockClear();
  });
  it('clears fleet_session cookie and redirects to /login', async () => {
    const { logout } = await import('@/features/auth/logout.action');
    await expect(logout()).rejects.toThrow('NEXT_REDIRECT');
    expect(cookieDelete).toHaveBeenCalledWith('fleet_session');
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});
