// apps/ops-web/test/login-page.test.tsx
// RED: login page renders form with username/password inputs and submit button.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('@/features/auth/login.action', () => ({ login: vi.fn() }));
describe('LoginPage', () => {
  it('renders username/password form with submit button', async () => {
    const { default: LoginPage } = await import('@/app/login/page');
    render(<LoginPage />);
    expect(screen.getByLabelText(/username/i)).toBeDefined();
    expect(screen.getByLabelText(/password/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDefined();
  });
});
