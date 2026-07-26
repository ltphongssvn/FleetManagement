// apps/ops-web/test/co-so-du-lieu-page.test.tsx
// The consolidated Co so du lieu admin page mounts the DriversSection AND the
// five shared master-data CRUD sections (Khach hang / Ten hang / So xe / Kho
// nhan hang / Kho giao hang) under the Co so du lieu heading, with a back-link
// to the dispatch board. Both DriversSection and ReferenceSection load via real
// fetch, so the test stubs globalThis.fetch URL-aware: /admin/drivers returns an
// array; /reference/* returns an { items } envelope. VN copy is immutable.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import CoSoDuLieuPage from '@/app/admin/co-so-du-lieu/page';
beforeEach(() => {
  globalThis.fetch = vi.fn((input: string | URL) => {
    const url = typeof input === 'string' ? input : input.href;
    const body = url.includes('/reference/') ? { items: [] } : [];
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    });
  }) as never;
});
describe('CoSoDuLieuPage', () => {
  it('renders the Co so du lieu heading', () => {
    render(<CoSoDuLieuPage />);
    expect(screen.getByRole('heading', { name: 'Cơ sở dữ liệu' })).toBeInTheDocument();
  });
  it('renders a back-link to the dispatch board', () => {
    render(<CoSoDuLieuPage />);
    const back = screen.getByTestId('co-so-du-lieu-back');
    expect(back).toHaveAttribute('href', '/');
  });
  it('mounts the drivers section', () => {
    render(<CoSoDuLieuPage />);
    expect(screen.getByTestId('drivers-section-loading')).toBeInTheDocument();
  });
  it('renders the five master-data section headings', () => {
    render(<CoSoDuLieuPage />);
    expect(screen.getByRole('heading', { name: 'Khách hàng' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tên hàng' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Số xe' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kho nhận hàng' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kho giao hàng' })).toBeInTheDocument();
  });
});
