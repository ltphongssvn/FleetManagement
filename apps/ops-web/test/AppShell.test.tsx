// apps/ops-web/test/AppShell.test.tsx
// TDD: AppShell renders nav, brand, logout, and children.
// Consolidation: the Doi xe (/admin/drivers) and Du lieu (/admin/reference)
// nav links are replaced by ONE Co so du lieu link (/admin/co-so-du-lieu).
// Tests assert the new link + href and the absence of the two old links,
// alongside the still-required Dieu phoi link, brand, children, badge, logout.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
vi.mock('@/features/auth/logout.action', () => ({ logout: vi.fn() }));
describe('AppShell', () => {
  it('renders brand, Dieu phoi, and the consolidated Co so du lieu link', async () => {
    const { AppShell } = await import('@/features/shell/AppShell');
    render(
      <AppShell>
        <div>child</div>
      </AppShell>,
    );
    expect(screen.getByText(/Điều phối xe/i)).toBeDefined();
    expect(screen.getByText('Điều phối')).toBeDefined();
    const db = screen.getByRole('link', { name: 'Cơ sở dữ liệu' });
    expect(db).toHaveAttribute('href', '/admin/co-so-du-lieu');
  });
  it('does NOT render the old Doi xe link', async () => {
    const { AppShell } = await import('@/features/shell/AppShell');
    render(
      <AppShell>
        <div />
      </AppShell>,
    );
    expect(screen.queryByRole('link', { name: /^Đội xe$/ })).toBeNull();
  });
  it('does NOT render the old Du lieu link', async () => {
    const { AppShell } = await import('@/features/shell/AppShell');
    render(
      <AppShell>
        <div />
      </AppShell>,
    );
    expect(screen.queryByRole('link', { name: /^Dữ liệu$/ })).toBeNull();
  });
  it('renders children inside main', async () => {
    const { AppShell } = await import('@/features/shell/AppShell');
    render(
      <AppShell>
        <span data-testid="kid">hello</span>
      </AppShell>,
    );
    expect(screen.getByTestId('kid').textContent).toBe('hello');
  });
  it('renders username badge when provided', async () => {
    const { AppShell } = await import('@/features/shell/AppShell');
    render(
      <AppShell username="dieuxe">
        <div />
      </AppShell>,
    );
    expect(screen.getByText('dieuxe')).toBeDefined();
  });
  it('omits username badge when not provided', async () => {
    const { AppShell } = await import('@/features/shell/AppShell');
    const { container } = render(
      <AppShell>
        <div />
      </AppShell>,
    );
    expect(container.textContent).not.toMatch(/dieuxe/);
  });
  it('renders logout button', async () => {
    const { AppShell } = await import('@/features/shell/AppShell');
    const { container } = render(
      <AppShell>
        <div />
      </AppShell>,
    );
    const btn = container.querySelector('button[type=submit]');
    expect(btn?.textContent).toMatch(/đăng xuất/i);
  });
});
