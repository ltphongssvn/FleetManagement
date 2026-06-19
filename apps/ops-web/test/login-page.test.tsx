// apps/ops-web/test/login-page.test.tsx
// RED: the login page renders the revised LoginForm (Continue with Keycloak, no
// credential inputs) and surfaces a /login?error= code as a friendly banner by
// mapping it through loginErrorMessage and passing initialError to LoginForm.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('@/features/auth/login.action', () => ({ startLogin: vi.fn() }));

describe('LoginPage', () => {
  it('renders the Keycloak sign-in button and no credential inputs', async () => {
    const { default: LoginPage } = await import('@/app/login/page');
    const { container } = render(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('button', { name: /keycloak|sign in/i })).toBeDefined();
    expect(container.querySelector('input[type=password]')).toBeNull();
    expect(container.querySelector('input[name=username]')).toBeNull();
  });

  it('shows a friendly banner when ?error= is a known callback code', async () => {
    const { default: LoginPage } = await import('@/app/login/page');
    render(await LoginPage({ searchParams: Promise.resolve({ error: 'invalid_state' }) }));
    expect(screen.getByRole('alert').textContent).toMatch(/verif|expired|try again/i);
  });

  it('shows a generic banner for an unknown provider error code', async () => {
    const { default: LoginPage } = await import('@/app/login/page');
    render(await LoginPage({ searchParams: Promise.resolve({ error: 'access_denied' }) }));
    expect(screen.getByRole('alert').textContent.length).toBeGreaterThan(0);
  });

  it('renders no banner when there is no error param', async () => {
    const { default: LoginPage } = await import('@/app/login/page');
    render(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
