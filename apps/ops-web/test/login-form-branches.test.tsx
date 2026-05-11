// apps/ops-web/test/login-form-branches.test.tsx
// TDD: cover LoginForm error rendering branches.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/features/auth/login.action', () => ({ login: vi.fn() }));

const reactMock = (state: unknown) => {
  vi.doMock('react', async () => {
    const actual = await vi.importActual<typeof import('react')>('react');
    return { ...actual, useActionState: () => [state, () => {}, false] };
  });
};

describe('LoginForm branches', () => {
  beforeEach(() => { vi.resetModules(); cleanup(); });

  it('renders auth_failed message', async () => {
    reactMock({ status: 'auth_failed', message: 'Invalid username or password' });
    const { LoginForm } = await import('@/features/auth/LoginForm');
    render(<LoginForm />);
    expect(screen.getByText(/Invalid username or password/i)).toBeDefined();
  });

  it('renders invalid field errors', async () => {
    reactMock({ status: 'invalid', errors: { username: 'Required', password: 'Required' } });  // pragma: allowlist secret
    const { LoginForm } = await import('@/features/auth/LoginForm');
    const { container } = render(<LoginForm />);
    expect(container.textContent).toMatch(/Required/);
  });

  it('renders server_error message', async () => {
    reactMock({ status: 'server_error', message: 'Server down' });
    const { LoginForm } = await import('@/features/auth/LoginForm');
    render(<LoginForm />);
    expect(screen.getByText(/Server down/i)).toBeDefined();
  });

  it('renders pending state', async () => {
    vi.doMock('react', async () => {
      const actual = await vi.importActual<typeof import('react')>('react');
      return { ...actual, useActionState: () => [undefined, () => {}, true] };
    });
    const { LoginForm } = await import('@/features/auth/LoginForm');
    const { container } = render(<LoginForm />);
    const btn = container.querySelector('button[type="submit"]');
    expect(btn?.hasAttribute('disabled')).toBe(true);
  });
});

import { beforeEach } from 'vitest';
