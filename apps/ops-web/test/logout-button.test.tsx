// apps/ops-web/test/logout-button.test.tsx
// RED: LogoutButton renders form posting to logout server action.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const logoutFn = vi.fn();
vi.mock('@/features/auth/logout.action', () => ({ logout: logoutFn }));
describe('LogoutButton', () => {
  it('renders Sign out button inside form bound to logout action', async () => {
    const { LogoutButton } = await import('@/features/auth/LogoutButton');
    render(<LogoutButton />);
    const btn = screen.getByRole('button', { name: /đăng xuất/i });
    expect(btn).toBeDefined();
    expect(btn.closest('form')).not.toBeNull();
  });
});
