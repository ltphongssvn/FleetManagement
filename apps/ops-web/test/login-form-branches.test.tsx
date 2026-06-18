// apps/ops-web/test/login-form-branches.test.tsx
// TDD: the revised LoginForm is a single 'Continue with Keycloak' button that
// submits to the startLogin server action (Authorization Code + PKCE). There is
// no username/password field. It still surfaces a server_error banner (e.g. OIDC
// misconfigured) returned by the action.
import type * as ReactNS from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/features/auth/login.action', () => ({ startLogin: vi.fn() }));

const reactMock = (state: unknown, pending = false): void => {
  vi.doMock('react', async () => {
    const actual = await vi.importActual<typeof ReactNS>('react');
    return {
      ...actual,
      useActionState: (): unknown => [state, function noopAction(): void { /* noop */ }, pending],
    };
  });
};

describe('LoginForm (Continue with Keycloak)', () => {
  beforeEach(() => { vi.resetModules(); cleanup(); });

  it('renders a single sign-in button and no password field', async () => {
    reactMock(undefined);
    const { LoginForm } = await import('@/features/auth/LoginForm');
    const { container } = render(<LoginForm />);
    expect(screen.getByRole('button', { name: /keycloak|sign in/i })).toBeDefined();
    expect(container.querySelector('input[type=password]')).toBeNull();
    expect(container.querySelector('input[name=username]')).toBeNull();
  });

  it('renders a server_error banner returned by the action', async () => {
    reactMock({ status: 'server_error', message: 'OIDC login is not configured' });
    const { LoginForm } = await import('@/features/auth/LoginForm');
    render(<LoginForm />);
    expect(screen.getByRole('alert').textContent).toMatch(/OIDC login is not configured/i);
  });

  it('disables the button while the redirect is pending', async () => {
    reactMock(undefined, true);
    const { LoginForm } = await import('@/features/auth/LoginForm');
    const { container } = render(<LoginForm />);
    const btn = container.querySelector('button[type=submit]');
    expect(btn?.hasAttribute('disabled')).toBe(true);
  });
});

describe('LoginForm action wiring', () => {
  beforeEach(() => { vi.resetModules(); cleanup(); });

  it('submitAction delegates to startLogin (ignoring prior state + formData)', async () => {
    const mod = await import('@/features/auth/login.action');
    const startLogin = vi.mocked(mod.startLogin);
    startLogin.mockResolvedValue({ status: 'server_error', message: 'x' });
    const { submitAction } = await import('@/features/auth/LoginForm');
    const result = await submitAction(undefined, new FormData());
    expect(startLogin).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'server_error', message: 'x' });
  });
});

describe('LoginForm initialError prop', () => {
  beforeEach(() => { vi.resetModules(); cleanup(); });

  it('renders an initialError banner when no live action error is present', async () => {
    reactMock(undefined);
    const { LoginForm } = await import('@/features/auth/LoginForm');
    render(<LoginForm initialError='Your sign-in session expired. Please try again.' />);
    expect(screen.getByRole('alert').textContent).toMatch(/session expired/i);
  });

  it('prefers a live server_error over initialError', async () => {
    reactMock({ status: 'server_error', message: 'Live action error' });
    const { LoginForm } = await import('@/features/auth/LoginForm');
    render(<LoginForm initialError='Stale callback error' />);
    expect(screen.getByRole('alert').textContent).toMatch(/Live action error/i);
  });

  it('renders no banner when neither initialError nor a live error is present', async () => {
    reactMock(undefined);
    const { LoginForm } = await import('@/features/auth/LoginForm');
    render(<LoginForm />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
