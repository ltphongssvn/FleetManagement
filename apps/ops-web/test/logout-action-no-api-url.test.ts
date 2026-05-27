// apps/ops-web/test/logout-action-no-api-url.test.ts
//
// Branch coverage for logout.action.ts line 14:
//   if (apiUrl === undefined || apiUrl.length === 0) return;
// When FLEET_API_URL is unset, the auto-backup is skipped and the
// logout still completes (cookie deleted + redirect).
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((to: string) => { throw new Error('REDIRECT:' + to); }) }));
import { cookies } from 'next/headers';
import { logout } from '../src/features/auth/logout.action.js';
describe('@fleet/ops-web - logout.action FLEET_API_URL guard', () => {
  beforeEach(() => {
    delete process.env['FLEET_API_URL'];
    vi.restoreAllMocks();
  });
  it('skips backup fetch when FLEET_API_URL is unset', async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'jwt' }),
      delete: vi.fn(),
    } as never);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }) as never);
    await expect(logout()).rejects.toThrow(/REDIRECT/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
