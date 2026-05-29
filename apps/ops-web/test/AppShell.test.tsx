// apps/ops-web/test/AppShell.test.tsx
// TDD: AppShell renders nav, brand, logout, and children.
// T5 update: the placeholder 'Đơn hàng' and 'Báo cáo' nav links are
// redundant href='#' dead-ends and must be removed. Tests now assert
// their absence in addition to the still-required Điều phối / Đội xe /
// Dữ liệu nav links.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('@/features/auth/logout.action', () => ({ logout: vi.fn() }));
describe('AppShell', () => {
  it('renders brand and remaining nav links', async () => {
    const { AppShell } = await import('@/features/shell/AppShell');
    render(<AppShell><div>child</div></AppShell>);
    expect(screen.getByText(/Điều phối xe/i)).toBeDefined();
    expect(screen.getByText('Điều phối')).toBeDefined();
    expect(screen.getByText('Đội xe')).toBeDefined();
    expect(screen.getByText('Dữ liệu')).toBeDefined();
  });
  it('does NOT render the redundant Đơn hàng placeholder link (T5)', async () => {
    const { AppShell } = await import('@/features/shell/AppShell');
    render(<AppShell><div /></AppShell>);
    expect(screen.queryByRole('link', { name: /^Đơn hàng$/ })).toBeNull();
  });
  it('does NOT render the redundant Báo cáo placeholder link (T5)', async () => {
    const { AppShell } = await import('@/features/shell/AppShell');
    render(<AppShell><div /></AppShell>);
    expect(screen.queryByRole('link', { name: /^Báo cáo$/ })).toBeNull();
  });
  it('renders children inside main', async () => {
    const { AppShell } = await import('@/features/shell/AppShell');
    render(<AppShell><span data-testid='kid'>hello</span></AppShell>);
    expect(screen.getByTestId('kid').textContent).toBe('hello');
  });
  it('renders username badge when provided', async () => {
    const { AppShell } = await import('@/features/shell/AppShell');
    render(<AppShell username='dieuxe'><div /></AppShell>);
    expect(screen.getByText('dieuxe')).toBeDefined();
  });
  it('omits username badge when not provided', async () => {
    const { AppShell } = await import('@/features/shell/AppShell');
    const { container } = render(<AppShell><div /></AppShell>);
    expect(container.textContent).not.toMatch(/dieuxe/);
  });
  it('renders logout button', async () => {
    const { AppShell } = await import('@/features/shell/AppShell');
    const { container } = render(<AppShell><div /></AppShell>);
    const btn = container.querySelector('button[type=submit]');
    expect(btn?.textContent).toMatch(/đăng xuất/i);
  });
});
