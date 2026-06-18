// apps/ops-web/test/login-page.test.tsx
// RED: the login page renders the revised LoginForm - a Continue with Keycloak
// button, no username/password inputs.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('@/features/auth/login.action', () => ({ startLogin: vi.fn() }));
describe('LoginPage', () => {
  it('renders the Keycloak sign-in button and no credential inputs', async () => {
    const { default: LoginPage } = await import('@/app/login/page');
    const { container } = render(<LoginPage />);
    expect(screen.getByRole('button', { name: /keycloak|sign in/i })).toBeDefined();
    expect(container.querySelector('input[type=password]')).toBeNull();
    expect(container.querySelector('input[name=username]')).toBeNull();
  });
});
