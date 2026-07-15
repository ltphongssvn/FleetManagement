// apps/ops-web/test/co-so-du-lieu-page.test.tsx
// RED-first for the consolidated Co so du lieu admin page. It mounts the
// DriversSection under the Co so du lieu heading with a back-link to the
// dispatch board. DriversSection loads via the default AdminDriversClient
// (real fetch), so the test stubs globalThis.fetch to reach a terminal state.
// Vietnamese heading + back-link are immutable UI contracts.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import CoSoDuLieuPage from '@/app/admin/co-so-du-lieu/page';

beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve([]),
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
});
